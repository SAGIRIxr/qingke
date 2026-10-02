param()
$ErrorActionPreference = 'Stop'
$CheckRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$CheckOutput = Join-Path $CheckRoot 'build\native-checks'
New-Item -ItemType Directory -Path $CheckOutput -Force | Out-Null
$CheckJava = Get-Command javac -ErrorAction Stop
$CheckSources = @('SchedulePlan', 'StatusPresentation', 'ShareRequestPolicy', 'ShareEntryPolicy', 'ShareEntryInbox', 'UpdatePolicy', 'UpdateDownload', 'UpdateJobs') | ForEach-Object { Join-Path $CheckRoot "app\src\main\java\cn\qingke\app\$_.java" }
$CheckTests = @('SchedulePlanTest', 'StatusPresentationTest', 'ShareRequestPolicyTest', 'ShareEntryPolicyTest', 'UpdatePolicyTest', 'UpdateJobsTest')
$CheckSources += $CheckTests | ForEach-Object { Join-Path $CheckRoot "native-tests\cn\qingke\app\$_.java" }
& $CheckJava.Source -encoding UTF-8 -d $CheckOutput @CheckSources
if ($LASTEXITCODE -ne 0) { throw 'Native schedule test compilation failed.' }
foreach ($CheckTest in $CheckTests) {
    & java -cp $CheckOutput "cn.qingke.app.$CheckTest"
    if ($LASTEXITCODE -ne 0) { throw "Native checks failed: $CheckTest" }
}
