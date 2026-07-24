@echo off
set PYTHONPATH=%cd%
python -m uvicorn server.app.main:app --reload --port 3002
