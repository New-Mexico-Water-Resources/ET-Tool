export const formatElapsedTime = (elapsedTime: number): string => {
  let formattedTimeRemaining = "";

  let timeRemainingSeconds = elapsedTime / 1000;
  let timeRemainingMinutes = Math.floor(timeRemainingSeconds / 60);
  timeRemainingSeconds = Math.floor(timeRemainingSeconds % 60);
  let timeRemainingHours = Math.floor(timeRemainingMinutes / 60);
  timeRemainingMinutes = Math.floor(timeRemainingMinutes % 60);
  let timeRemainingDays = Math.floor(timeRemainingHours / 24);
  timeRemainingHours = Math.floor(timeRemainingHours % 24);

  if (timeRemainingDays > 0) {
    if (timeRemainingHours > 0) {
      timeRemainingDays += timeRemainingHours / 24;
      timeRemainingDays = Math.round(timeRemainingDays * 10) / 10;
    }

    formattedTimeRemaining += `${timeRemainingDays} days `;
  } else if (timeRemainingHours > 0) {
    if (timeRemainingMinutes > 0) {
      timeRemainingHours += timeRemainingMinutes / 60;
      timeRemainingHours = Math.round(timeRemainingHours * 10) / 10;
    }
    formattedTimeRemaining += `${timeRemainingHours} hours `;
  } else if (timeRemainingMinutes > 0) {
    if (timeRemainingSeconds > 0) {
      timeRemainingMinutes += 1;
    }
    formattedTimeRemaining += `${timeRemainingMinutes} minutes `;
  } else if (timeRemainingSeconds > 0) {
    formattedTimeRemaining += `< 1 minute `;
  } else {
    formattedTimeRemaining = "N/A";
  }

  return formattedTimeRemaining;
};

export const formJobForQueue = (jobName: string, startYear: number, endYear: number, geojson: any): any => {
  let strippedName = jobName.replace(/[^a-zA-Z0-9]/g, "_");
  let jobKey = `${strippedName}_${startYear}_${endYear}_${Date.now()}`;
  let newJob = {
    key: jobKey,
    cmd: `/opt/conda/bin/python /app/water-rights-visualizer-backend-S3.py /root/data/water_rights_runs/${jobKey}/config.json`,
    status: "Pending",
    status_msg: null,
    submitted: new Date().toISOString(),
    started: null,
    ended: null,
    invoker: "to-do",
    name: jobName,
    start_year: startYear,
    end_year: endYear,
    geo_json_file: `/root/data/water_rights_runs/${jobKey}/${jobName}.geojson`,
    loaded_geo_json: geojson,
    base_dir: `/root/data/water_rights_runs/${jobKey}`,
    png_dir: `/root/data/water_rights_runs/${jobKey}/output/figures/${jobName}`,
    csv_dir: `/root/data/water_rights_runs/${jobKey}/output/monthly_nan/${jobName}`,
    years_processed: [],
  };

  return newJob;
};

export default {};
