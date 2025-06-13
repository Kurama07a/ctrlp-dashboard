import asyncio
import websockets
import json
import subprocess
import os
from datetime import datetime
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

class PrinterMonitor:
    def __init__(self):
        self.clients = set()
        self.previous_printer_state = {}
        
    async def register(self, websocket):
        self.clients.add(websocket)
        logging.info(f"Client connected. Total clients: {len(self.clients)}")
        # Send initial printer state
        await self.check_and_notify_changes(force_notify=True)

    async def unregister(self, websocket):
        self.clients.remove(websocket)
        logging.info(f"Client disconnected. Total clients: {len(self.clients)}")

    def get_printer_status(self):
        script_path = "temp_printer_check.ps1"
        ps_script = """
        $printers = Get-WmiObject Win32_Printer | Where-Object { $_.PortName -like 'USB*' }
        $pnpDevices = Get-WmiObject Win32_PnPEntity | Where-Object { 
            $_.PNPDeviceID -like 'USB\\*' -or $_.PNPDeviceID -like 'USBPRINT\\*' 
        }

        $results = @()
        foreach ($printer in $printers) {
            $usbDevice = $pnpDevices | Where-Object { 
                $_.PNPDeviceID -eq $printer.PNPDeviceID -and $_.PNPDeviceID -like 'USB\\*' 
            } | Select-Object -First 1
            
            if ($null -eq $usbDevice) {
                $usbDevice = $pnpDevices | Where-Object { 
                    $_.PNPDeviceID -like 'USBPRINT\\*' -and $_.PNPDeviceID -like "*$($printer.Name)*" 
                } | Select-Object -First 1
            }

            $printerInfo = @{
                name = $printer.Name
                port = $printer.PortName
                deviceId = $printer.DeviceID
                status = $printer.PrinterStatus
                driverName = $printer.DriverName
                location = if ($null -eq $printer.Location) { "Unknown" } else { $printer.Location }
                isConnected = if ($null -eq $usbDevice) { $false } else { $true }
                busAddress = if ($null -eq $usbDevice) { "Not Connected" } else { $usbDevice.PNPDeviceID }
                lastChecked = [DateTime]::UtcNow.ToString("o")
            }
            $results += $printerInfo
        }
        ConvertTo-Json -InputObject $results -Compress
        """

        try:
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(ps_script)

            result = subprocess.run(
                ["powershell", "-ExecutionPolicy", "Bypass", "-File", script_path],
                capture_output=True,
                text=True,
                check=True
            )
            
            if result.stdout.strip():
                return json.loads(result.stdout)
            return []

        except Exception as e:
            logging.error(f"Error getting printer status: {str(e)}")
            return []
        finally:
            if os.path.exists(script_path):
                try:
                    os.remove(script_path)
                except Exception as e:
                    logging.error(f"Error removing temporary script: {str(e)}")

    async def check_and_notify_changes(self, force_notify=False):
        current_state = self.get_printer_status()
        
        if force_notify or current_state != self.previous_printer_state:
            message = {
                "type": "printer_status",
                "timestamp": datetime.utcnow().isoformat(),
                "data": current_state
            }
            
            if self.clients:
                await asyncio.gather(
                    *[client.send(json.dumps(message)) for client in self.clients],
                    return_exceptions=True
                )
            
            self.previous_printer_state = current_state

    async def monitor_printers(self):
        while True:
            try:
                await self.check_and_notify_changes()
                await asyncio.sleep(5)  # Check every 5 seconds
            except Exception as e:
                logging.error(f"Error in monitor loop: {str(e)}")
                await asyncio.sleep(5)

    async def ws_handler(self, websocket):
        """
        Handler for WebSocket connections - removed path parameter
        """
        try:
            await self.register(websocket)
            async for message in websocket:
                try:
                    data = json.loads(message)
                    if data.get('type') == 'request_status':
                        await self.check_and_notify_changes(force_notify=True)
                except json.JSONDecodeError:
                    logging.error(f"Invalid JSON received: {message}")
        except websockets.exceptions.ConnectionClosed:
            logging.info("Client connection closed normally")
        except Exception as e:
            logging.error(f"Error handling websocket connection: {str(e)}")
        finally:
            await self.unregister(websocket)

async def main():
    monitor = PrinterMonitor()
    
    async with websockets.serve(
        monitor.ws_handler,  # Use the new handler name
        "localhost",
        8765,
        ping_interval=None
    ) as server:
        logging.info("Printer Monitor Server started on ws://localhost:8765")
        monitor_task = asyncio.create_task(monitor.monitor_printers())
        
        try:
            await asyncio.Future()  # run forever
        except KeyboardInterrupt:
            logging.info("Server shutdown initiated")
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Server stopped by user")