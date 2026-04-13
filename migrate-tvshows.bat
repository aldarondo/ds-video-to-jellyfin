@echo off
node "C:\Users\Aldarondo Family\Documents\Github\ds-video-to-jellyfin\dist\cli.js" ^
  -i "V:\TV Shows" ^
  -o "V:\jellyfin\TV Shows" ^
  --years-file "C:\Users\Aldarondo Family\Documents\Github\ds-video-to-jellyfin\show-years.json" ^
  >> "C:\Users\Aldarondo Family\Documents\Github\ds-video-to-jellyfin\migrate-tvshows.log" 2>&1
