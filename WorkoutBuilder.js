/**
 * Garmin Workout Builder
 * ----------------------
 * A JavaScript tool to create and upload custom workouts to Garmin Connect.
 * Workouts are defined in a CSV file and converted into the Garmin Connect JSON format,
 * supporting warmup, cooldown, steady steps, and repeat (interval) steps.
 *
 * Author: Stefano2723
 * License: Apache 2.0
 */
(async function() {
  // ---------- Hilfsfunktionen ----------
  function parseCSVLine(line) {
    // einfacher CSV-Parser, unterstützt auch Anführungszeichen
    const res = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          cur += '"'; // escaped quote
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        res.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    res.push(cur.trim());
    return res.map(cell => {
      if (cell.startsWith('"') && cell.endsWith('"')) {
        cell = cell.slice(1, -1).replace(/""/g, '"');
      }
      return cell;
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ---------- Core: CSV verarbeiten und Workout bauen ----------
  async function createWorkoutsFromCSVText(csvText) {
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) { console.warn("Keine CSV-Zeilen gefunden."); return; }

    // optional: wenn Header vorhanden (z. B. Name,Abschnitte,...), überspringen
    const firstCols = parseCSVLine(lines[0]).map(c => c.toLowerCase());
    let startIndex = 0;
    if (firstCols[0].includes('name') && firstCols.includes('abschnitte')) startIndex = 1;

    for (let i = startIndex; i < lines.length; i++) {
      try {
        const cols = parseCSVLine(lines[i]);
        if (cols.length < 4) {
          console.warn(`Zeile ${i+1}: zu wenige Spalten -> übersprungen.`);
          continue;
        }

        const workoutName = cols[0] || `Workout-${i}`;
        const numSegments = parseInt(cols[1]) || 0; // Anzahl der "Abschnitte" (logical steps)
        const warmupSec = parseInt(cols[2]) || 0;
        const cooldownSec = parseInt(cols[3]) || 0;

        // IDs / Orders für Steps innerhalb des Segments
        let stepId = 1;
        let stepOrder = 1;

        const workoutSteps = [];

        // --- Warmup als eigener Step (falls >0) ---
        if (warmupSec > 0) {
          workoutSteps.push({
            stepId: stepId++,
            stepOrder: stepOrder++,
            stepType: { stepTypeId: 1, stepTypeKey: "warmup", displayOrder: 1 },
            type: "ExecutableStepDTO",
            endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
            endConditionValue: warmupSec,
            description: "Z1",
            stepAudioNote: null,
            targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 }
          });
        }

        // --- Die "Abschnitte" aus der CSV: jedes 'Abschnitt' wird eine Reihe von Steps
        // Spaltenstruktur: ab Index 4 jeweils 4 Felder pro Abschnitt: name,durationMin,pauseMin,repeats
        for (let s = 0; s < numSegments; s++) {
          const base = 4 + s * 4;
          if (base + 3 >= cols.length) {
            console.warn(`Zeile ${i+1}: Abschnitt ${s+1} unvollständig, übersprungen.`);
            continue;
          }
          const name = cols[base] || `Step${s+1}`;
          const durationSec = cols[base + 1] || "0";
          const pauseSec = cols[base + 2] || "0";
          const repeats = parseInt(cols[base + 3]) || 0;

          if (repeats > 0) {
            // -> RepeatGroupDTO: enthält child steps (Intervall + Recovery)
            const repeatStepId = stepId++;
            const repeatStepOrder = stepOrder++;

            const childSteps = [];

            // Child 1: Intervall (z.B. time-based)
            const child1 = {
              stepId: stepId++,
              stepOrder: stepOrder++,
              stepType: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
              type: "ExecutableStepDTO",
              endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
              endConditionValue: durationSec,
              description: name,
              stepAudioNote: null,
              childStepId: null, // optional
              targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 }
            };
            // set childStepId to first child within group if needed
            child1.childStepId = child1.stepId;

            childSteps.push(child1);

            // Child 2: Recovery / Pause
            const child2 = {
              stepId: stepId++,
              stepOrder: stepOrder++,
              stepType: { stepTypeId: 4, stepTypeKey: "recovery", displayOrder: 4 },
              type: "ExecutableStepDTO",
              endCondition: null, // set below
              endConditionValue: null,
              description: "Z1",
              stepAudioNote: null,
              childStepId: child1.stepId,
              preferredEndConditionUnit: null,
              targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 }
            };

            if (pauseSec > 0) {
              child2.endCondition = { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true };
              child2.endConditionValue = pauseSec;
            } else {
              // Pause == 0 -> beende mit Lap Button
              child2.endCondition = { conditionTypeId: 1, conditionTypeKey: "lap.button", displayOrder: 1, displayable: true };
              child2.endConditionValue = 0;
            }

            childSteps.push(child2);

            const repeatGroup = {
              stepId: repeatStepId,
              stepOrder: repeatStepOrder,
              stepType: { stepTypeId: 6, stepTypeKey: "repeat", displayOrder: 6 },
              numberOfIterations: repeats,
              smartRepeat: false,
              // childStepId: id of the first child step of the group (use child1.stepId)
              childStepId: childSteps.length > 0 ? childSteps[0].stepId : null,
              workoutSteps: childSteps,
              endCondition: { conditionTypeId: 7, conditionTypeKey: "iterations", displayOrder: 7, displayable: false },
              type: "RepeatGroupDTO",
              skipLastRestStep: true
            };

            workoutSteps.push(repeatGroup);

          } else {
            // -> einfacher ausführbarer Step (kein Repeat)
            const step = {
              stepId: stepId++,
              stepOrder: stepOrder++,
              stepType: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 }, // treat as interval-like or normal
              type: "ExecutableStepDTO",
              endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
              endConditionValue: durationSec,
              description: name,
              stepAudioNote: null,
              targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 }
            };
            
            workoutSteps.push(step);            
          }
        } // Ende segments loop

        // --- Cooldown als eigener Step (falls >0) ---
        if (cooldownSec > 0) {
          workoutSteps.push({
            stepId: stepId++,
            stepOrder: stepOrder++,
            stepType: { stepTypeId: 2, stepTypeKey: "cooldown", displayOrder: 2 },
            type: "ExecutableStepDTO",
            endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
            endConditionValue: cooldownSec,
            description: "Z1",
            stepAudioNote: null,
            targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 }
          });
        }

        else
        {
            workoutSteps.push({
            stepId: stepId++,
            stepOrder: stepOrder++,
            stepType: { stepTypeId: 2, stepTypeKey: "cooldown", displayOrder: 2 },
            type: "ExecutableStepDTO",
            endCondition: { conditionTypeId: 1, conditionTypeKey: "lap.button", displayOrder: 2, displayable: true },
            endConditionValue: 0,
            description: "Z1",
            stepAudioNote: null,
            targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 }
          });
        }

        // --- Workout-JSON zusammenbauen ---
        const workoutJSON = {
          sportType: { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 },
          subSportType: null,
          workoutName: workoutName,
          estimatedDistanceUnit: { unitKey: null },
          workoutSegments: [
            {
              segmentOrder: 1,
              sportType: { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 },
              workoutSteps: workoutSteps
            }
          ],
          "avgTrainingSpeed": 3.0,
          estimatedDurationInSecs: 0,
          estimatedDistanceInMeters: 0,
          estimateType: null,
          isWheelchair: false
        };

        console.log(`Erzeuge Workout "${workoutName}" (Schritte: ${workoutSteps.length})`);
        // Debug: bei Problemen kannst du das JSON hier ansehen:
        // console.log(JSON.stringify(workoutJSON, null, 2));

        // --- CSRF-Token aus Meta (aktiver Garmin-Tab) ---
        const tokenMeta = document.querySelector('meta[name="csrf-token"]');
        const csrfToken = tokenMeta ? tokenMeta.getAttribute('content') : null;
        if (!csrfToken) {
          console.error("CSRF-Token nicht gefunden. Bitte in Garmin Connect eingeloggt sein und Seite aktiv halten.");
          return;
        }

        // --- POST an Garmin (gc-api) ---
        try {
          const resp = await fetch("https://connect.garmin.com/gc-api/workout-service/workout", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "connect-csrf-token": csrfToken,
              "Accept": "application/json"
            },
            body: JSON.stringify(workoutJSON)
          });

          const text = await resp.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch(e) { parsed = text; }

          if (!resp.ok) {
            console.error("Server-Error:", resp.status, parsed);
          } else {
            console.log("Antwort vom Server:", parsed);
          }
        } catch (e) {
          console.error("Fehler beim Senden:", e);
        }

        // Kleiner Delay zwischen den Requests, um Rate-Limits zu vermeiden
        await sleep(400);
      } catch (err) {
        console.error(`Fehler bei Zeile ${i+1}:`, err);
      }
    } // Ende lines loop
  }

  // ---------- Datei-Auswahl starten ----------
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv';
  input.onchange = async () => {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      await createWorkoutsFromCSVText(String(e.target.result || ""));
    };
    reader.readAsText(file);
  };
  input.click();

})();

