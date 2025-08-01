## 1.29.0 (2025-06-12)

### Features
- New ET Tool icon
- Adds support for exporting the report in acre-feet/month units
  - Refactors units to use a custom abstraction layer to make it easier to add new units in the future
- "Clear Pending" button now also clears jobs that are waiting approval
- Automatically opens show preview on interactive preview toggle

## Bug Fixes
- Always uses calculated acreage instead of optionally relying on the shapefile's "Acres" property
  - This fixes an issue where the acreage was showing as 0 for some jobs where the field was set, but the value was incorrect
- Fixes minor scrolling issue with the new jobs panel where the scrollbar would appear when it wasn't needed
- Fixes color scale width so large numbers or numbers with many decimal places don't cause the color scale to overflow or be too wide

## 1.28.0 (2025-05-28)

### Features
- Report axis scaling and layout changes
  - Standardizes the y-axis for the ET, PPT, and Cloud Coverage charts so the scale for each respectively is the same across all years
  - Shows x-axis ticks at the bottom of each chart for better readability
  - Shows horizontal grid lines for better readability
  - Rounds y-axis numbers to the nearest "nice" number for better interpretability
    - The number of subdivisions will now additionally change dynamically based on the range of the data
- New full-page report summary figure
  - The ET, PPT, and Cloud Coverage charts are now additionally displayed on a single page in landscape orientation at the end of the report that spans all years

### Bug Fixes
- Ensures y-axis labels are displayed as whole numbers when possible
- Adds error handling for nice number conversion
- Increased logging for Landsat pass count

## 1.27.0 (2025-05-21)

### Features
- Adds new Reference layer showing all jobs on the map
  - Clicking on a job will open the active job modal
  - Adds ability to navigate through all jobs and auto-zoom to each job
- Adds more detail to geojson tooltip

### Bug Fixes
- Removes MODIS PET upgrade step from the pipeline
- Fixes bug where draw controls disappear behind the right side modal if the modal is open, a polygon is drawn, and then the new job modal is closed
- Adds error handling for old jobs with malformed geojson files


## 1.26.0 (2025-05-15)

### Features
- Switches auto-bounds to go to 2 standard deviations above and below the mean for MODIS data
- Adds county level tooltips to the map for ingested MODIS data to show mean and standard deviation values

### Bug Fixes
- Fixes bug where MODIS PET was showing as the same value as ET for ingested dates after 2025-03-14
- Adds error handling for case where mongodb doesn't return the running job and requestor user can't be found
- Refactors and standardizes MODIS pipeline code

## 1.25.0 (2025-05-08)

### Features
- Automatically shows preview on play button click

### Bug Fixes
- Adds improved backoff and retry logic for Planetary Computer STAC API to fetch Landsat pass count
  - While this does add some latency to the report generation process, it greatly reduces the likelihood of a failed pass count fetch due to rate limiting
  - Closes the STAC API session after fetching pass count to reduce memory usage
- Refactors and standardizes PNG generation code, ensuring same color scale is used for all PNGs
- Refactors and standardizes report generation code
- Reduces max memory used when generating reports by downscaling PNGs to output size on load and separating metric and imperial calculations
- Interactive preview color scale wasn't showing when color scale started at 0

## 1.24.0 (2025-05-01)

### Features
- Adds PET data to MODIS pipeline
  - New "MODIS PET 500" layer is available in the "Map Layers" panel
- Adds new calculated ESI base map layer
  - ESI is calculated as ET / PET for all non-NaN values
  - New "MODIS ESI 500" layer is available in the "Map Layers" panel
- Adds auto-min/max color scaling button to the MODIS base map layers
  - This allows users to easily view the full range of data for a given layer
- Adds dynamic color scale option for interactive monthly data

### Bug Fixes
- Fixes tooltip persistance bugs
- Hides interactive preview collapse menu if no job is selected


## 1.23.0 (2025-04-24)

### Features
- Adds area label on polygon hover
- Clips MODIS data to state boundary, which greatly reduces the number of tiles that need to be loaded and improves performance

### Bug Fixes
- Fixes sidebar toggle controls (Cmd/Ctrl + B)
- Moves map zoom controls, polygon creation controls, and color scale to the left of the sidebar when open

## 1.22.0 (2025-04-17)

### Features
- Adds slider to view monthly data on the map for a given job
  - Play button to animate through the months
- Adds ability to view monthly data before 2008 on the map
- Adds ability to download all GeoTIFFs for a given job
- Tooltips for New Mexico Counties reference layer
- Moves active job properties and preview controls to collapsible sections

### Bug Fixes
- Moves downloading of all resources behind authentication to reduce server load
- Fixes bug blocking target date from being changed for MODIS Terra True Color imagery
- Closes New Job menu if "Locate" button is clicked from the queue
- Adds error handling for missing ET column when generating reports if monthly CSVs contain malformed data

## 1.21.0 (2025-04-10)

### Features
- **New Active Job Controls** 
  - Adds ability to download geotiff subsets for a given job under the new "Download" dropdown menu
  - Adds live geotiff preview capabilities for monthly data
- **MODIS Data Layer Updates**
  - New "Update" button for MODIS data layers panel
    - Allows settings to be configured before updating the map layer
  - Adds a "jump to latest day" button to switch the target date to the latest available day
- **Performance Improvements**
  - Interpolation is skipped for monthly data for all dates on 2008 and after

### Bug Fixes
- Hides unimplemented MODIS options in the "Map Layers" panel
- Fixes time out error when fetching Landsat pass count from Microsoft Planetary Computer STAC API


## 1.20.0 (2025-04-03)

### Features
- Adds a new MODIS tile server for displaying MODIS data
  - From "Map Layers", you can now select "MODIS ET 500", then select static or dynamic data (currently only dynamic is available), and then select a date and min/max
- Adds a new MODIS pipeline for processing MODIS data
  - Data is polled from NASA Earthdata Cloud and converted into GeoTIFFs every 24 hours
- "Queue" tab wording updated to "In Progress"
- Minor optimizations and bug fixes with interpolation


## 1.19.0 (2025-03-27)

### Features
- Appends data layer documentation to the end of the report

### Bug Fixes
- Fixes issue where NaN values were being reported as 100% in the monthly CSV output
- Fixes 0 scaling issue where 0% cloud coverage wasn't being displayed properly in the report
- Fixes issue where PPT values were being reported as 0 in the monthly CSV output if there was a NaN value in the monthly data

## 1.18.0 (2025-03-18)

### Features
- Adds "Requested By" field to the generated report
- Switches "Avg Cloud Coverage & Missing Data" metric for >= 2008 data to use the total count of Landsat passes as a denominator instead of days in the month
  - This change provides a more accurate representation of cloud coverage and missing data as it pertains to confidence and more closely aligns with the pre-2008 metric
  - Total Landsat pass count is determined by querying the Microsoft Planetary Computer STAC API for the given region and month
    - Landsat 5, 7, 8, and 9 are all included in the count. 
    - NOTE: Since pass counting is done on demand after the fact instead of stored with the data, there may be some discrepancies between the number of passes and the actual cloud coverage/missing data values in the report (miscounts would likely lead to a higher reported cloud coverage percentage than actual)
- Includes Landsat pass count in CSV output
- Includes ET-adjusted and uncorrected PET values in CSV output for transparency
  - Rounds to 2 decimal places
- Standardizes ET color scale across years in the report
  - The color scale is now consistent across all years, making it easier to compare ET values over time
  - Min and max are determined by looking at 2 standard deviations above and below the mean for all years in the report

### Bug Fixes
- Fixes bug where a year's monthly CSV would get overwritten in some edge cases, causing null data to be reported in the output CSV (showing up as 100% cloud coverage) despite being correctly displayed in the report
- Fixes y-scaling issue for pre-2008 PET data in the report
- Fixes failed to fetch error for some 2019-12 tiles

## 1.17.0 (2025-03-12)

### Features
- Adds ability to draw custom regions from map
- Adds New Mexico State Boundary and Counties references to the map
- Changes legend label for ETo (2008 and after PET) to be more clear
- Scales ETo to daylight hours to more closely match the daylight hours ET
  - This is done by multiplying the ETo value by the ratio of daylight hours to 24 hours
  - Since 2 different models are used for ETo and ET, an additional correction is included to ensure ETo is always greater than ET


### Bug Fixes
- Clears status and finished fields when restarting job


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