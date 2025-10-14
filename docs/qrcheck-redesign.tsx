<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QRCheck.ca - Privacy-first QR inspection</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            overflow-x: hidden;
            background: linear-gradient(180deg, #0a0520, #1a0a3e, #0a0520);
            color: white;
            min-height: 100vh;
            transition: background 0.5s ease, color 0.5s ease;
        }

        body.light-mode {
            background: linear-gradient(180deg, #e0f2fe, #bae6fd, #e0f2fe);
            color: #0f172a;
        }

        body.light-mode .logo p {
            color: #0369a1;
        }

        body.light-mode .settings-btn {
            background: rgba(14, 165, 233, 0.2);
        }

        body.light-mode .settings-btn:hover {
            background: rgba(14, 165, 233, 0.3);
        }

        body.light-mode .hero-card {
            background: linear-gradient(135deg, #0ea5e9, #0284c7);
        }

        body.light-mode .quishing-btn {
            background: rgba(241, 245, 249, 0.8);
            color: #0f172a;
        }

        body.light-mode .quishing-btn:hover {
            background: rgba(226, 232, 240, 0.9);
        }

        body.light-mode .quishing-content {
            background: rgba(241, 245, 249, 0.8);
            color: #0f172a;
        }

        body.light-mode .quishing-content p {
            color: #334155;
        }

        body.light-mode .warning-card {
            background: linear-gradient(135deg, rgba(220, 38, 38, 0.9), rgba(185, 28, 28, 0.9));
        }

        body.light-mode footer {
            color: #64748b;
        }

        .particle-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            pointer-events: none;
            z-index: 0;
        }

        .particle-container::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(10, 5, 32, 0.7);
            pointer-events: none;
            transition: background 0.5s ease;
        }

        body.light-mode .particle-container::after {
            background: rgba(255, 255, 255, 0.6);
        }

        .particle {
            position: absolute;
            border-radius: 50%;
            animation: float linear infinite;
            opacity: 0;
        }

        @keyframes float {
            0% {
                transform: translateY(0) translateX(0);
                opacity: 0;
            }
            10% {
                opacity: 1;
            }
            90% {
                opacity: 1;
            }
            100% {
                transform: translateY(100vh) translateX(var(--drift));
                opacity: 0;
            }
        }

        .particle.pink { background: #ff1493; box-shadow: 0 0 8px #ff1493; }
        .particle.magenta { background: #ff00ff; box-shadow: 0 0 8px #ff00ff; }
        .particle.purple { background: #9d00ff; box-shadow: 0 0 8px #9d00ff; }
        .particle.blue { background: #0080ff; box-shadow: 0 0 8px #0080ff; }
        .particle.cyan { background: #00d4ff; box-shadow: 0 0 8px #00d4ff; }
        .particle.deep-purple { background: #6600cc; box-shadow: 0 0 6px #6600cc; }

        .content {
            position: relative;
            z-index: 1;
        }

        .container {
            max-width: 768px;
            margin: 0 auto;
            padding: 0 1rem;
        }

        header {
            padding: 1.5rem 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .logo h1 {
            font-size: 2rem;
            font-weight: bold;
            margin-bottom: 0.25rem;
        }

        .logo p {
            color: #93c5fd;
            font-size: 0.875rem;
        }

        .settings-btn {
            width: 3rem;
            height: 3rem;
            border-radius: 50%;
            background: rgba(59, 130, 246, 0.2);
            backdrop-filter: blur(8px);
            border: none;
            cursor: pointer;
            font-size: 1.5rem;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .settings-btn:hover {
            background: rgba(59, 130, 246, 0.3);
            transform: scale(1.05);
        }

        .hero-wrapper {
            position: relative;
            margin: 2rem 0;
        }

        .hero-glow {
            position: absolute;
            inset: 0;
            background: linear-gradient(90deg, #06b6d4, #0891b2);
            border-radius: 1.5rem;
            filter: blur(40px);
            opacity: 0.15;
            animation: pulse 3s ease-in-out infinite;
        }

        body.light-mode .hero-glow {
            opacity: 0.1;
        }

        @keyframes pulse {
            0% {
                opacity: 0.15;
            }
            50% {
                opacity: 0.25;
            }
            100% {
                opacity: 0.15;
            }
        }

        body.light-mode .hero-glow {
            animation: pulseLightMode 3s ease-in-out infinite;
        }

        @keyframes pulseLightMode {
            0% {
                opacity: 0.1;
            }
            50% {
                opacity: 0.18;
            }
            100% {
                opacity: 0.1;
            }
        }

        .hero-card {
            position: relative;
            background: linear-gradient(135deg, #3b82f6, #2563eb);
            border-radius: 1.5rem;
            padding: 2rem;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }

        .hero-icon {
            text-align: center;
            margin-bottom: 1.5rem;
        }

        .emoji-wrapper {
            position: relative;
            display: inline-block;
        }

        .emoji-glow {
            position: absolute;
            inset: 0;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 50%;
            filter: blur(12px);
        }

        .emoji {
            position: relative;
            font-size: 4rem;
            display: inline-block;
            animation: bounce 2s ease-in-out infinite;
        }

        @keyframes bounce {
            0% {
                transform: translateY(0);
            }
            50% {
                transform: translateY(-10px);
            }
            100% {
                transform: translateY(0);
            }
        }

        .hero-title {
            font-size: 2.5rem;
            font-weight: bold;
            text-align: center;
            margin-bottom: 1rem;
            line-height: 1.2;
        }

        .hero-subtitle {
            color: #bfdbfe;
            text-align: center;
            font-size: 1.125rem;
            margin-bottom: 1.5rem;
        }

        .action-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            margin-bottom: 1.5rem;
        }

        .action-btn {
            background: rgba(255, 255, 255, 0.2);
            backdrop-filter: blur(12px);
            border: none;
            border-radius: 1rem;
            padding: 1.5rem;
            cursor: pointer;
            transition: all 0.3s;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.75rem;
            color: white;
        }

        .action-btn:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: scale(1.05);
        }

        .action-btn svg {
            width: 2rem;
            height: 2rem;
        }

        .action-btn span {
            font-size: 1.125rem;
            font-weight: 600;
        }

        .last-scanned {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(8px);
            border-radius: 0.75rem;
            padding: 1rem;
            text-align: center;
        }

        .last-scanned-label {
            color: #bfdbfe;
            font-size: 0.875rem;
            margin-bottom: 0.25rem;
        }

        .last-scanned-url {
            font-family: monospace;
            font-size: 0.875rem;
            word-break: break-all;
        }

        .quishing-btn {
            width: 100%;
            background: rgba(30, 41, 59, 0.5);
            backdrop-filter: blur(8px);
            border: none;
            border-radius: 1rem;
            padding: 1rem;
            margin: 2rem 0;
            cursor: pointer;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            transition: all 0.3s;
            font-size: 1.125rem;
        }

        .quishing-btn:hover {
            background: rgba(30, 41, 59, 0.7);
        }

        .quishing-icon {
            color: #fbbf24;
        }

        .quishing-arrow {
            color: #94a3b8;
        }

        .quishing-content {
            background: rgba(30, 41, 59, 0.5);
            backdrop-filter: blur(8px);
            border-radius: 1rem;
            padding: 1.5rem;
            margin-bottom: 2rem;
            animation: slideDown 0.3s ease-out;
        }

        @keyframes slideDown {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .quishing-content h3 {
            font-size: 1.25rem;
            margin-bottom: 0.75rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .quishing-content p {
            color: #cbd5e1;
            line-height: 1.6;
        }

        .warning-wrapper {
            position: relative;
            margin: 2rem 0;
        }

        .warning-glow {
            position: absolute;
            inset: 0;
            background: #ef4444;
            border-radius: 1.5rem;
            filter: blur(40px);
            opacity: 0.3;
        }

        .warning-card {
            position: relative;
            background: linear-gradient(135deg, rgba(127, 29, 29, 0.9) 0%, rgba(153, 27, 27, 0.9) 100%);
            backdrop-filter: blur(12px);
            border-radius: 1.5rem;
            padding: 2rem;
            border: 2px solid rgba(239, 68, 68, 0.5);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            text-align: center;
        }

        .warning-icon-wrapper {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 5rem;
            height: 5rem;
            background: rgba(239, 68, 68, 0.2);
            border-radius: 50%;
            margin-bottom: 1rem;
        }

        .warning-icon-wrapper svg {
            width: 3rem;
            height: 3rem;
            color: #fca5a5;
        }

        .warning-title {
            font-size: 2rem;
            font-weight: bold;
            margin-bottom: 0.75rem;
            color: #fecaca;
        }

        .warning-subtitle {
            color: #fca5a5;
            font-size: 1.125rem;
            margin-bottom: 1.5rem;
        }

        .warning-details {
            background: rgba(69, 10, 10, 0.5);
            border-radius: 0.75rem;
            padding: 1rem;
            text-align: left;
        }

        .warning-item {
            display: flex;
            align-items: start;
            gap: 0.75rem;
            margin-bottom: 0.5rem;
        }

        .warning-item:last-child {
            margin-bottom: 0;
        }

        .warning-emoji {
            color: #fca5a5;
            margin-top: 0.25rem;
        }

        .warning-text {
            color: #fca5a5;
            font-size: 0.875rem;
        }

        footer {
            text-align: center;
            padding: 2rem 0;
            color: #94a3b8;
            font-size: 0.875rem;
        }

        @media (max-width: 640px) {
            .hero-title {
                font-size: 2rem;
            }

            .hero-subtitle {
                font-size: 1rem;
            }

            .action-buttons {
                gap: 0.75rem;
            }

            .action-btn {
                padding: 1.25rem;
            }
        }

        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="particle-container" id="particleContainer"></div>

    <div class="content">
        <div class="container">
            <header>
                <div class="logo">
                    <h1>QRCheck.ca</h1>
                    <p>Privacy-first QR inspection</p>
                </div>
                <button class="settings-btn" onclick="toggleTheme()" id="themeToggle">🌙</button>
            </header>

            <div class="hero-wrapper">
                <div class="hero-glow"></div>
                <div class="hero-card">
                    <div class="hero-icon">
                        <div class="emoji-wrapper">
                            <div class="emoji-glow"></div>
                            <span class="emoji">🎯</span>
                        </div>
                    </div>
                    <h2 class="hero-title">Don't just YOLO that QR code!</h2>
                    <p class="hero-subtitle">Know before you scan. Quick, free, private safety check.</p>

                    <div class="action-buttons">
                        <button class="action-btn" onclick="handleCamera()">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
                            </svg>
                            <span>Camera</span>
                        </button>
                        <button class="action-btn" onclick="handleUpload()">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                            </svg>
                            <span>Upload</span>
                        </button>
                    </div>

                    <div class="last-scanned">
                        <p class="last-scanned-label">Last scanned</p>
                        <p class="last-scanned-url">https://0.nybk.ru</p>
                    </div>
                </div>
            </div>

            <button class="quishing-btn" onclick="toggleQuishing()">
                <span class="quishing-icon">⚡</span>
                <span>What's "Quishing"?</span>
                <span class="quishing-arrow" id="quishingArrow">▶</span>
            </button>

            <div class="quishing-content hidden" id="quishingContent">
                <h3>
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 1.5rem; height: 1.5rem; color: #60a5fa;">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                    </svg>
                    Quishing Explained
                </h3>
                <p>"Quishing" is QR code phishing - a cyberattack where malicious QR codes redirect you to fake websites designed to steal your personal information, passwords, or financial data. Always verify before you scan!</p>
            </div>

            <div class="warning-wrapper">
                <div class="warning-glow"></div>
                <div class="warning-card">
                    <div class="warning-icon-wrapper">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                        </svg>
                    </div>
                    <h3 class="warning-title">Don't Open This! 🚫</h3>
                    <p class="warning-subtitle">Multiple red flags detected. This is likely malicious.</p>

                    <div class="warning-details">
                        <div class="warning-item">
                            <span class="warning-emoji">⚠️</span>
                            <p class="warning-text">Suspicious domain pattern detected</p>
                        </div>
                        <div class="warning-item">
                            <span class="warning-emoji">⚠️</span>
                            <p class="warning-text">URL shortener detected (hides real destination)</p>
                        </div>
                        <div class="warning-item">
                            <span class="warning-emoji">⚠️</span>
                            <p class="warning-text">Recently registered domain (less than 30 days)</p>
                        </div>
                    </div>
                </div>
            </div>

            <footer>
                <p>Your privacy matters. All scans are processed locally.</p>
            </footer>
        </div>
    </div>

    <script>
        const container = document.getElementById('particleContainer');
        const colors = ['pink', 'magenta', 'purple', 'blue', 'cyan', 'deep-purple'];
        const particleCount = 300;

        function createParticle() {
            const particle = document.createElement('div');
            particle.className = `particle ${colors[Math.floor(Math.random() * colors.length)]}`;
            
            const size = Math.random() * 4 + 2;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.top = `${Math.random() * -100}vh`;
            
            const duration = Math.random() * 15 + 10;
            particle.style.animationDuration = `${duration}s`;
            
            particle.style.animationDelay = `${Math.random() * -20}s`;
            
            const drift = (Math.random() - 0.5) * 100;
            particle.style.setProperty('--drift', `${drift}px`);
            
            container.appendChild(particle);
            
            setTimeout(() => {
                particle.remove();
                createParticle();
            }, (duration + 20) * 1000);
        }

        for (let i = 0; i < particleCount; i++) {
            createParticle();
        }

        setInterval(() => {
            if (container.children.length < particleCount * 2) {
                createParticle();
            }
        }, 200);

        function toggleQuishing() {
            const content = document.getElementById('quishingContent');
            const arrow = document.getElementById('quishingArrow');
            
            if (content.classList.contains('hidden')) {
                content.classList.remove('hidden');
                arrow.textContent = '▼';
            } else {
                content.classList.add('hidden');
                arrow.textContent = '▶';
            }
        }

        function handleCamera() {
            alert('Camera scanning feature would open here');
        }

        function handleUpload() {
            alert('File upload feature would open here');
        }

        function toggleTheme() {
            const body = document.body;
            const themeToggle = document.getElementById('themeToggle');
            
            body.classList.toggle('light-mode');
            
            if (body.classList.contains('light-mode')) {
                themeToggle.textContent = '☀️';
            } else {
                themeToggle.textContent = '🌙';
            }
        }
    </script>
</body>
</html>