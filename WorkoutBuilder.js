/**
 * Garmin Workout Builder
 * ----------------------
 * A JavaScript tool to create and upload custom workouts to Garmin Connect.
 * Workouts are defined in a CSV file and converted into the Garmin Connect JSON format,
 * supporting warmup, cooldown, steady steps, and repeat (interval) steps.
 *
 * Author: Stefano2712
 * License: Apache 2.0
 */
(async function () {
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
            } else if (ch === ';' && !inQuotes) {
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

    function getZoneNumberFromName(name) {
        if (!name) return null;
        const m = String(name).match(/\b(?:z|zone)\s*([1-9])\b/i);
        return m ? parseInt(m[1], 10) : null;
    }

    function buildTargetForStep(name, isBike) {
        if (!isBike) {
            // RUN: kein Target
            return {
                targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 }
            };
        }
        const zone = getZoneNumberFromName(name);
        if (zone != null) {
            return {
                targetType: { workoutTargetTypeId: 2, workoutTargetTypeKey: "power.zone", displayOrder: 2 },
                zoneNumber: zone,
                targetValueOne: null,
                targetValueTwo: null,
                targetValueUnit: null
            };
        }
        // Fallback: keine Zone erkannt → no.target
        return {
            targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 }
        };
    }

    // ---------- Core: CSV verarbeiten und Workout bauen ----------
    async function createWorkoutsFromCSVText(csvText) {
        // ==== Defaults für die Schätzung (m/s) → nach Bedarf anpassen ====
        const DEFAULT_SPEED_RUN_MPS = 2.94; // 05:40 pace
        const DEFAULT_SPEED_BIKE_MPS = 6.94; // 25.0  km/h

        const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 0) { console.warn("Keine CSV-Zeilen gefunden."); return; }

        // optional: wenn Header vorhanden (z. B. Name,Abschnitte,...), überspringen
        let firstCols = parseCSVLine(lines[0]).map(c => c.toLowerCase());
        let startIndex = 0;
        let isBikeWorkout = false;

        if (firstCols[0].includes('name') && firstCols.includes('abschnitte')) startIndex += 1;

        firstCols = parseCSVLine(lines[startIndex]).map(c => c.toLowerCase());
        if (firstCols[0].includes('bike')) {
            startIndex += 1;
            isBikeWorkout = true;
        }
        // -------------------------

        for (let i = startIndex; i < lines.length; i++) {
            try {
                const cols = parseCSVLine(lines[i]);
                if (cols.length < 4) {
                    console.warn(`Zeile ${i + 1}: zu wenige Spalten -> übersprungen.`);
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

                // *** Planung: Summe der bekannten Zeiten in Sekunden ***
                let totalPlannedSecs = 0;

                // --- Warmup als eigener Step (falls >0) ---
                if (warmupSec > 0) {
                    const nameWarm = "Z1";
                    const targetWarm = buildTargetForStep(nameWarm, isBikeWorkout);

                    workoutSteps.push({
                        stepId: stepId++,
                        stepOrder: stepOrder++,
                        stepType: { stepTypeId: 1, stepTypeKey: "warmup", displayOrder: 1 },
                        type: "ExecutableStepDTO",
                        endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
                        endConditionValue: warmupSec,
                        description: nameWarm,
                        stepAudioNote: null,
                        targetType: targetWarm.targetType,
                        ...(targetWarm.zoneNumber != null ? {
                            zoneNumber: targetWarm.zoneNumber,
                            targetValueOne: targetWarm.targetValueOne,
                            targetValueTwo: targetWarm.targetValueTwo,
                            targetValueUnit: targetWarm.targetValueUnit
                        } : {})
                    });

                    totalPlannedSecs += warmupSec;
                }

                // --- Abschnitte aus der CSV
                // Spaltenstruktur: ab Index 4 je Abschnitt 4 Felder: name, durationSec, pauseSec, repeats
                for (let s = 0; s < numSegments; s++) {
                    const base = 4 + s * 4;
                    if (base + 3 >= cols.length) {
                        console.warn(`Zeile ${i + 1}: Abschnitt ${s + 1} unvollständig, übersprungen.`);
                        continue;
                    }

                    const name = cols[base] || `Step${s + 1}`;
                    const durationSec = parseInt(cols[base + 1]) || 0;
                    const pauseSec = parseInt(cols[base + 2]) || 0;
                    const repeats = parseInt(cols[base + 3]) || 0;

                    if (repeats > 0) {
                        // RepeatGroupDTO mit 2 Child-Schritten (Intervall + Recovery)
                        const repeatStepId = stepId++;
                        const repeatStepOrder = stepOrder++;

                        const childSteps = [];

                        // Child 1: Intervall
                        const targetOn = buildTargetForStep(name, isBikeWorkout);
                        const child1 = {
                            stepId: stepId++,
                            stepOrder: stepOrder++,
                            stepType: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
                            type: "ExecutableStepDTO",
                            endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
                            endConditionValue: durationSec,
                            description: name,
                            stepAudioNote: null,
                            childStepId: null,
                            targetType: targetOn.targetType,
                            ...(targetOn.zoneNumber != null ? {
                                zoneNumber: targetOn.zoneNumber,
                                targetValueOne: targetOn.targetValueOne,
                                targetValueTwo: targetOn.targetValueTwo,
                                targetValueUnit: targetOn.targetValueUnit
                            } : {})
                        };
                        child1.childStepId = child1.stepId;
                        childSteps.push(child1);

                        // Child 2: Recovery
                        const nameRec = "Z1"; // immer Z1 als Erholung
                        const targetRec = buildTargetForStep(nameRec, isBikeWorkout);
                        const child2 = {
                            stepId: stepId++,
                            stepOrder: stepOrder++,
                            stepType: { stepTypeId: 4, stepTypeKey: "recovery", displayOrder: 4 },
                            type: "ExecutableStepDTO",
                            endCondition: null, // gleich gesetzt
                            endConditionValue: null,
                            description: nameRec,
                            stepAudioNote: null,
                            childStepId: child1.stepId,
                            preferredEndConditionUnit: null,
                            targetType: targetRec.targetType,
                            ...(targetRec.zoneNumber != null ? {
                                zoneNumber: targetRec.zoneNumber,
                                targetValueOne: targetRec.targetValueOne,
                                targetValueTwo: targetRec.targetValueTwo,
                                targetValueUnit: targetRec.targetValueUnit
                            } : {})
                        };

                        if (pauseSec > 0) {
                            child2.endCondition = { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true };
                            child2.endConditionValue = pauseSec;
                        } else {
                            // Pause == 0 → beende per Lap Button
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
                            childStepId: childSteps[0]?.stepId ?? null,
                            workoutSteps: childSteps,
                            endCondition: { conditionTypeId: 7, conditionTypeKey: "iterations", displayOrder: 7, displayable: false },
                            type: "RepeatGroupDTO",
                            skipLastRestStep: true
                        };

                        workoutSteps.push(repeatGroup);

                        // geplante Dauer summieren (pro Iteration: on + ggf. off)
                        let perIter = 0;
                        perIter += durationSec;
                        perIter += (pauseSec > 0 ? pauseSec : 0); // Lap-Button-Pause zählt 0
                        totalPlannedSecs += repeats * perIter;

                    } else {
                        // einfacher Step (kein Repeat)
                        const target = buildTargetForStep(name, isBikeWorkout);

                        const step = {
                            stepId: stepId++,
                            stepOrder: stepOrder++,
                            stepType: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
                            type: "ExecutableStepDTO",
                            endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
                            endConditionValue: durationSec,
                            description: name,
                            stepAudioNote: null,
                            targetType: target.targetType,
                            ...(target.zoneNumber != null ? {
                                zoneNumber: target.zoneNumber,
                                targetValueOne: target.targetValueOne,
                                targetValueTwo: target.targetValueTwo,
                                targetValueUnit: target.targetValueUnit
                            } : {})
                        };

                        workoutSteps.push(step);
                        totalPlannedSecs += durationSec;
                    }
                } // Ende Abschnitte

                // --- Cooldown als eigener Step ---
                const nameCool = "Z1";
                const targetCool = buildTargetForStep(nameCool, isBikeWorkout);

                const endCondition = cooldownSec > 0
                    ? { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true }
                    : { conditionTypeId: 1, conditionTypeKey: "lap.button", displayOrder: 2, displayable: true };

                const endConditionValue = cooldownSec > 0 ? cooldownSec : 0;

                workoutSteps.push({
                    stepId: stepId++,
                    stepOrder: stepOrder++,
                    stepType: { stepTypeId: 2, stepTypeKey: "cooldown", displayOrder: 2 },
                    type: "ExecutableStepDTO",
                    endCondition,
                    endConditionValue,
                    description: nameCool,
                    stepAudioNote: null,
                    targetType: targetCool.targetType,
                    ...(targetCool.zoneNumber != null ? {
                        zoneNumber: targetCool.zoneNumber,
                        targetValueOne: targetCool.targetValueOne,
                        targetValueTwo: targetCool.targetValueTwo,
                        targetValueUnit: targetCool.targetValueUnit
                    } : {})
                });

                totalPlannedSecs += cooldownSec; // Lap-Button-Cooldown zählt 0

                // --- Workout-JSON zusammenbauen ---
                const sportTypeId = isBikeWorkout ? 2 : 1; // 1 = running, 2 = cycling
                const sportTypeKey = isBikeWorkout ? "cycling" : "running";

                // ==== Schätzung setzen ====
                const avgTrainingSpeed = isBikeWorkout ? DEFAULT_SPEED_BIKE_MPS : DEFAULT_SPEED_RUN_MPS; // m/s
                const estimatedDistanceInMeters = totalPlannedSecs * avgTrainingSpeed;

                const workoutJSON = {
                    sportType: { sportTypeId, sportTypeKey, displayOrder: 1 },
                    subSportType: null,
                    workoutName,
                    avgTrainingSpeed,
                    estimatedDurationInSecs: totalPlannedSecs,
                    estimatedDistanceInMeters,
                    workoutSegments: [
                        {
                            segmentOrder: 1,
                            sportType: { sportTypeId, sportTypeKey, displayOrder: 1 },
                            workoutSteps
                        }
                    ],
                    avgTrainingSpeed,
                    estimateType: "DISTANCE_ESTIMATED",
                    "estimatedDistanceUnit": {
                        "unitId": 2,
                        "unitKey": "kilometer",
                        "factor": 100000
                    },
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
                    try { parsed = JSON.parse(text); } catch (e) { parsed = text; }

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
                console.error(`Fehler bei Zeile ${i + 1}:`, err);
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
