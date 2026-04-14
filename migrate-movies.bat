@echo off
node "C:\Users\Aldarondo Family\Documents\Github\ds-video-to-jellyfin\dist\cli.js" ^
  -i "V:\Movies" ^
  -o "V:\jellyfin\Movies" ^
  --hardlink ^
  --overwrite ^
  --years-file "C:\Users\Aldarondo Family\Documents\Github\ds-video-to-jellyfin\show-years.json" ^
  >> "C:\Users\Aldarondo Family\Documents\Github\ds-video-to-jellyfin\migrate-movies.log" 2>&1
