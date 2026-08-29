from pathlib import Path
ROOT=Path(__file__).resolve().parent
SRC=ROOT/'src'
ORDER=[
 '01-core.js','02-flight.js','03-duty-ftl.js','04-roster-trips.js',
 '05-imports.js','06-exports.js','07-payroll.js','expiry.js','08-cloud.js','09-ui.js'
]
banner='''/*
 PilotLog source map
  01 Core/storage/settings
  02 Airports/night/flight-entry rules
  03 Duty + EASA FTL
  04 Roster + trips
  05 Imports
  06 Exports
  07 Payroll
  08 Expiry / validity tracking
  09 Cloud sync
  10 UI/render/events
*/
'''
out=banner+''.join((SRC/name).read_text(encoding='utf-8') for name in ORDER)
(ROOT/'app.js').write_text(out,encoding='utf-8')
print('app.js rebuilt')
