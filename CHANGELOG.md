## 1.16.0 (2025-01-29)

### Features
- Adds support for KML files
- Adds pagination for users to prevent too many requests to Auth0 (admin feature)

### Bug Fixes
- Adds better error messaging for Auth0 rate limiting
- Fixes issue fetching job status/location for job names with special charactres in them

## 1.15.0 (2025-01-28)

### Features
- Shows area in acres for uploaded files
- Shows total area for all visible polygons in a multipolygon job

### Bug Fixes
- Fixes bug where job status would show in an error state for multipolygon jobs after submitting
- Strips special characters from job names to prevent issues with file paths when downloading
- Hides "job name" field for multipolygons as the individual layer name overwrites it

## 1.14.0 (2025-01-27)

### Bug Fixes
- Fixes issue listing all users as an admin (previously caused issues above 50 users)
- Fixes issue with job status showing an error state after submitting 

## 1.13.0 (2025-01-27)

### Features
- Allows users to delete their own job before they're approved

### Bug Fixes
- Shows y axis labels for ET and PPT with 1 decimal place to reduce duplicate number rounding when using imperial units
- Makes the job configuration side panel scrollable for smaller screens

## 1.12.0 (2025-01-27)

### Features
- Admin feature to restart successfully completed jobs in case report generation changed

### Bug Fixes
- Fixes memory issue with report generation
- Restart job button clears already processed figures for re-running just the report
- Changes > 2008 data to OpenET Cloud Coverage and Missing Data


## 1.11.0 (2025-01-25)

### Bug Fixes
- Fixes issue with multi-polygon shapefiles that have non-standard "Acres" property
- Fixes issue where shapefile isn't found if the zip file is named differently than its parent folder

## 1.10.0 (2025-01-17)

### Features
- Adds new Map Layers tab to the application
  - Available data boundary objects can be toggled on and off here instead of in the "New Job" popup
  - Option to configure the base map and choose corresponding imagery date if applicable (eg. for MODIS)
  - Max zoom level is configured per base map to prevent zooming in past tile boundary
- Job runner performance enhancements
  - Jobs are now picked up much quicker due to a switch to collection subscriptions instead of polling
  - Logs are flushed after every line, meaning they now come out much cleaner and quicker
  - Code refactor to help with maintainability
- Development environment improvements
  - Job runner can now be run fully locally outside of docker file
  - Adds term coloring to the job runner logs for easier reading
- Adds locate button to "New Job" popup to center the map on the uploaded area
- Active job modal improvements
  - Includes a locate button to center the map on the job area
  - Adds a Download GeoJSON button to download just the job area as a GeoJSON file regardless of job status
  - Shows status as Complete if the job is in a "Complete" state
- Adds a "Date submitted" filter to the backlog to make the list easier to navigate
- Makes the pause button work immediately (within 5 seconds) as opposed to stopping at the end of the year
- Better progress estimation based on latest date in logs 

### Bug Fixes
- Fixes bug where active job occassionally would get out of sync from the corresponding job in the queue
- If the job runner was killed (due to a server restart/update, eg.) while a job was "In Progress", the job would get stuck in that state
  - This has been fixed by adding a check for stalled jobs and picking them up again if no PID is found active


## 1.9.0 (2025-01-09)

### Features
- Adds a max area size (100000000 m^2 or ~24710 acres) for jobs to prevent users from submitting jobs that are too large
- Adds more support and error handling for geojson and shapefile variations with malformed artifacts included

### Bug Fixes
- Fixes bug where multiple combined CSVs were showing up in zip for Windows users 

## 1.8.0 (2025-01-08)

### Features
- Tags releases with the version number in the GitHub repository for easier rollback and tracking
- Forces unit selection on download

### Bug Fixes
- Allows jobs to be deleted when they're in a "Paused" state
- Fixes y scaling issue in the imperial unit report caused by the OpenET model min/max interval not being converted to inches

## 1.7.0 (2025-01-03)

### Bug Fixes
- Disables download dropdown menu if download is not available
- Fixes an edge case issue with job cleanup where if a tool update occured while a job was running, it could cause the runner to hang
  - This was due to the PID stored in the DB occassionally being incorrect in this case, so the cleanup script would kill the runner process. This has been fixed by verifying the PID doesn't match the runner before killing it and updating the DB before killing as a fail safe.


## 1.6.0 (2024-12-20)

### Features
- Adds a dropdown menu option to "Download" where users can specify the units for the report
  - Users can choose between mm/month and inches/month for the ET, PET, and PPT data
- Includes PPT and Cloud Coverage values in the CSV export
- Updates report bottom graphs title to "Average Monthly Water Use, Precipitation, and Cloud Coverage"

### Bug Fixes
- Fixed an issue where PPT wasn't showing up for older 1985 - 2008 data
- Changes Cloud Cov. to Cloud Coverage in the report

## 1.5.0 (2024-12-18)

### Features
- Full page report layout
  - The report is now the size of a standard 8.5 x 11 inch page
  - Avg. Cloud Coverage & Missing Data is now displayed as a separated line chart below the ET and PET chart
  - ROI tiles are now bigger
  - Updated wording for data sources at the bottom of the page
- Precipitation data is now displayed in the report
  - Precipitation data is displayed as a line chart below the ET and PET chart
  - Data comes from the Oregon State PRISM dataset and is credited at the bottom of the generated report
- Adds ability to rename parts of a multipolygon job
  - Users can now rename the parts of a multipolygon job to better identify them in the queue

### Bug Fixes
- Increased error handling for missing data in the report
- Fixed an issue with certain variable tiles after 2018 not being correctly mapped to their relative S3 location

## 1.4.0 (2024-12-11)

### Features
- Shows an error messsage and prevents the user from submitting a job if the target area is too small (less than 900 m^2)
- Adds a toggle to show "valid bounds" on the map for the area we have data for
- Shows all available properties in job status

### Bug Fixes
- Adds error handling for jobs involving areas that are too small being run
  - The job would run as normal, fetch all necessary tiles, but then fail due to the "valid" area mask being empty as it didn't cover any pixels

## 1.3.0 (2024-12-05)

### Features
- Report layout adjustments
  - Font sizes, spacing, and stroke widths have been adjusted to make the report more readable
  - The ROI month grid has been adjusted to take more advantage of the space in a 3 x 4 grid (versus 2 x 6)
  - For pre-OpenET data, the legend title was updated to "Avg Cloud Cov. & Missing Data" to better reflect the data being displayed
  - The line plot title was also adjusted to reflect the inclusion of missing data visualizations
- Line plot colors have been adjusted to be more distinct from the color gradient bar
  - PET is now purple and ET is orange

### Bug Fixes
- The PDF version of the report now contains less whitespace around the edges so it appears more similar to the PNG per year
- Typo fix in the report title for "Evapotranspiration"

## 1.2.0 (2024-12-04)

### Features
- Updated the format of the generated report to:
    - provide more space for the line chart at the bottom
    - include legend items for confidence
    - make legends more readable (changes orientation of text labels on the color gradient bar displayed next to the ROI charts)
    - remove redundant information (eg. years shown for every tile instead of just the month)
- Updated error reporting for OpenET data (2008 to 2023 data)
    - Now includes average cloud coverage percentage as a bar chart behind the lines
    - ET confidence interval is the OpenET Ensemble model min and max value range
- Older PT-JPL data confidence is now displayed as a bar chart behind the lines for report standardization
- Release Notes are now generated automatically from the `CHANGELOG.md` file.
    - Persists yellow "new" state whether release notes for this version have been checked or not
- Persists the sorting options for the backlog
- Adds simple 404 page allowing the user to return back to the application

### Bug Fixes
- The `status` line on items in the queue would overflow out of the container if the job failed and it was too long
- Caches the list of users for 1 to 10 minutes (deep and shallow caching time limits) to reduce the number of fetches to the authentication provider (only visible to admins)
  - In some cases, this was leading to slow user list load times due to rate limiting on the Auth0 side
- Better handles missing uncertainty data (shows as unavailable in the report if we don't have any data for the month)


---

> **Note:** The changelog history started on 2024-12-04.