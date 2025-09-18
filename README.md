# Garmin Workout Builder

A **JavaScript tool** to automatically create structured **workouts in Garmin Connect** – directly from your browser.
The program reads training plans from a **CSV file**, converts them into the JSON format required by Garmin, and uploads them to Garmin Connect via API.

## ✨ Features

* Automatically create **workouts** in Garmin Connect (running, cycling, etc.,, change as needed)
* Supports multiple step types:

  * Warmup
  * Intervals
  * Repeats (`repeat` with nested steps)
  * Recovery phases
  * Cooldown
* Import from **CSV files**: Simple text-based structure for training plans
* Handles workout structures including repetitions and pauses
* Automatically grabs the **CSRF token** from Garmin Connect
* Runs directly in the **browser**, as long as you’re logged into Garmin Connect

## ⚙️ How it works

1. Open Garmin Connect in your browser and log in
2. Open the developer console and load the script
3. Select a CSV file with your workouts
4. The script converts CSV → JSON and sends it to the Garmin Workout API
5. Your workouts appear in your Garmin Connect account


## 📝 CSV

```csv
Structure:
Name,NumofSteps,Warmup,Cooldown,Step1Description,Duration,Pause,Reps,Step2Description,Duration,Pause,Reps[...]
```

Example file:

```csv
MorningRun,1,300,300,Zone5,1200,0,0
Interval Training,2,300,0,Zone2,300,0,0,Zone5,120,30,5
```

* **Warmup / Cooldown**: duration in seconds, when cooldown is 0 then cooldown finishes by pressing lap button
* **Description
* **Duration**: duration of step in seconds* 
* **Pause**: `0` = end with lap button, `>0` = pause in seconds (intervals only)
* **Reps**: number of repetitions for intervals (if 0 then no interval)

## 📦 Installation

No installation required – simply:

* Open Garmin Connect in your browser
* Open the **Developer Tools console**
* Paste or load the script
* Select your CSV file and run

## 🚧 Status

* Proof of Concept / Hobby project
* Not officially supported by Garmin
* Tested in Chrome browser only

