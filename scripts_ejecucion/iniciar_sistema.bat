@echo off
title SISTEMA DE SEGURIDAD BIOMETRICO IoT - EMPRESARIOTEC S.A.
color 0B
echo =========================================================================
echo  SISTEMA DE SEGURIDAD BIOMETRICO IoT - EMPRESARIOTEC S.A.
echo  SENATI - PIAD-526: INICIANDO SERVIDOR MAESTRO Y TERMINALES
echo =========================================================================
cd /d "%~dp0\.."
python server.py
pause
