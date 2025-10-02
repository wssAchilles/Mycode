@echo off
setlocal enableextensions

echo Checking database service status...
echo.

echo MongoDB service status:
sc query MongoDB
echo.

echo PostgreSQL service status:
sc query postgresql-x64-16
echo.

echo Redis/Memurai service status:
sc query Redis 2>nul || sc query Memurai 2>nul || echo Redis/Memurai service not found
echo.

echo Checking listening ports:
echo MongoDB (port 27017):
netstat -an | findstr /R /C:":27017"
echo.

echo PostgreSQL (port 5432):
netstat -an | findstr /R /C:":5432"
echo.

echo Redis (port 6379):
netstat -an | findstr /R /C:":6379"
echo.

echo Done.

endlocal
