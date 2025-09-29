⚙️ Setup

Clone the repository:

git clone https://github.com/USERNAME/desktop-chatbot.git
cd desktop-chatbot


Create a .env file with your OpenAI credentials:

OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5-mini


Run the server:

python main.py


Open in browser:

http://127.0.0.1:5000

🖥 Desktop Shortcut

To start the app quickly, use the included .bat script:

@echo off
cd /d "%~dp0"
if exist ".venv\Scripts\activate.bat" call ".venv\Scripts\activate.bat"
python main.py
pause


Create a desktop shortcut pointing to this script.

📂 Project Structure
desktop-chatbot/
│── static/          # CSS, JS
│── templates/       # HTML templates
│── uploads/         # Uploaded files
│── chatbot.db       # SQLite database
│── main.py          # Flask backend
│── app.js           # Frontend logic
│── styles.css       # UI styling
│── requirements.txt # Dependencies
│── startchatbot.bat # Quick start script

🤖 AI Model

Default: gpt-5-mini

Temperature: 1.0 (balanced creativity)

Supports Markdown output:

Bullet points

Tables

Fenced code blocks

📌 Notes

This project is intended for personal use and learning purposes.

Experimental .exe builds can be tested via a dedicated branch using PyInstaller.

The UI runs locally, but an internet connection is required for OpenAI API requests.

📜 License

MIT License – free to use, modify, and distribute with attribution.