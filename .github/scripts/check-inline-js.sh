#!/bin/bash
# Extract inline <script> blocks from index.html and run node --check on each.
# Called by the js-syntax-check workflow.

set -euo pipefail

INPUT="index.html"

awk '
BEGIN { n = 0; ec = 0 }
/<\/script>/ {
  if (block != "") {
    n++
    fname = "/tmp/inline-script-" n ".js"
    print block > fname
    close(fname)
    cmd = "node --check " fname " 2>&1"
    result = system(cmd)
    if (result != 0) {
      print "FAIL inline script block #" n > "/dev/stderr"
      ec = 1
    } else {
      print "OK inline script block #" n
    }
    close(cmd)
    block = ""
  }
  next
}
/<script[^>]*>/ {
  if (match($0, /src\s*=\s*["'\'']/)) {
    next
  }
  sub(/.*<script[^>]*>/, "")
  block = $0
  next
}
{
  if (block != "") block = block "\n"
  block = block $0
}
END {
  if (n == 0) print "No inline script blocks found."
  exit ec
}
' "$INPUT"
