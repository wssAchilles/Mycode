<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>智能Web应用系统 - 首页</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #74b9ff 0%, #0984e3 50%, #6c5ce7 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .container {
            max-width: 800px;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
            animation: slideIn 0.8s ease-out;
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .header {
            background: linear-gradient(45deg, #00b894, #00cec9);
            color: white;
            text-align: center;
            padding: 40px 20px;
        }

        .header h1 {
            font-size: 3em;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }

        .header p {
            font-size: 1.3em;
            opacity: 0.9;
        }

        .content {
            padding: 40px;
        }

        .feature-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 25px;
            margin-bottom: 30px;
        }

        .feature-card {
            background: #f8f9fa;
            padding: 25px;
            border-radius: 15px;
            text-align: center;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            border: 2px solid transparent;
        }

        .feature-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            border-color: #00b894;
        }

        .feature-icon {
            font-size: 3em;
            margin-bottom: 15px;
        }

        .feature-card h3 {
            color: #2d3436;
            margin-bottom: 10px;
            font-size: 1.3em;
        }

        .feature-card p {
            color: #636e72;
            line-height: 1.6;
        }

        .cta-section {
            text-align: center;
            margin: 30px 0;
            padding: 30px;
            background: linear-gradient(135deg, #fd79a8, #fdcb6e);
            border-radius: 15px;
            color: white;
        }

        .cta-button {
            display: inline-block;
            background: white;
            color: #fd79a8;
            padding: 15px 30px;
            border-radius: 50px;
            text-decoration: none;
            font-weight: bold;
            font-size: 1.1em;
            margin: 10px;
            transition: all 0.3s ease;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }

        .cta-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0,0,0,0.2);
        }

        .info-section {
            background: #f1f2f6;
            padding: 25px;
            border-radius: 15px;
            margin: 20px 0;
        }

        .info-section h3 {
            color: #2d3436;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .tech-stack {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 15px;
        }

        .tech-badge {
            background: #00b894;
            color: white;
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 0.9em;
            font-weight: 500;
        }

        .footer {
            background: #2d3436;
            color: white;
            text-align: center;
            padding: 20px;
        }

        .current-time {
            font-family: 'Courier New', monospace;
            font-size: 1.1em;
            color: #00b894;
            font-weight: bold;
        }

        @media (max-width: 768px) {
            .header h1 {
                font-size: 2.2em;
            }

            .feature-grid {
                grid-template-columns: 1fr;
            }

            .cta-button {
                display: block;
                margin: 10px 0;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🌟 欢迎来到智能Web系统</h1>
            <p>基于 Java Servlet 技术构建的现代化Web应用</p>
        </div>

        <div class="content">
            <div class="feature-grid">
                <div class="feature-card">
                    <div class="feature-icon">🚀</div>
                    <h3>高性能</h3>
                    <p>基于Java Servlet技术，提供快速响应和高并发处理能力</p>
                </div>

                <div class="feature-card">
                    <div class="feature-icon">🎨</div>
                    <h3>美观界面</h3>
                    <p>现代化的UI设计，响应式布局，完美适配各种设备</p>
                </div>

                <div class="feature-card">
                    <div class="feature-icon">🔧</div>
                    <h3>功能丰富</h3>
                    <p>包含用户交互、表单处理、会话管理等多种实用功能</p>
                </div>
            </div>

            <div class="cta-section">
                <h2>🎯 开始体验我们的功能</h2>
                <p style="margin: 15px 0;">探索强大的Servlet应用，感受现代Web技术的魅力</p>
                <a href="<%= request.getContextPath() %>/hello-servlet" class="cta-button">
                    🎮 进入主应用
                </a>
                <a href="<%= request.getContextPath() %>/hello-servlet?name=<%= java.net.URLEncoder.encode("新用户", "UTF-8") %>" class="cta-button">
                    👤 新用户体验
                </a>
            </div>

            <div class="info-section">
                <h3>📊 系统信息</h3>
                <p><strong>当前时间:</strong> <span class="current-time" id="currentTime"></span></p>
                <p><strong>服务器状态:</strong> <span style="color: #00b894;">✅ 正常运行</span></p>
                <p><strong>会话ID:</strong> <%= session.getId().substring(0, 8) %>...</p>
                <p><strong>访问IP:</strong> <%= request.getRemoteAddr() %></p>
            </div>

            <div class="info-section">
                <h3>🛠️ 技术栈</h3>
                <p>本项目采用了以下现代化技术：</p>
                <div class="tech-stack">
                    <span class="tech-badge">Java</span>
                    <span class="tech-badge">Servlet API</span>
                    <span class="tech-badge">JSP</span>
                    <span class="tech-badge">HTML5</span>
                    <span class="tech-badge">CSS3</span>
                    <span class="tech-badge">JavaScript</span>
                    <span class="tech-badge">Maven</span>
                    <span class="tech-badge">Tomcat</span>
                </div>
            </div>

            <div class="info-section">
                <h3>📚 功能特色</h3>
                <ul style="list-style: none; padding: 0;">
                    <li style="margin: 10px 0; padding: 10px; background: white; border-radius: 8px;">
                        🔄 <strong>实时数据处理</strong> - 动态生成内容，实时响应用户操作
                    </li>
                    <li style="margin: 10px 0; padding: 10px; background: white; border-radius: 8px;">
                        📱 <strong>响应式设计</strong> - 完美适配桌面、平板和手机设备
                    </li>
                    <li style="margin: 10px 0; padding: 10px; background: white; border-radius: 8px;">
                        🛡️ <strong>会话管理</strong> - 安全的用户会话跟踪和状态维护
                    </li>
                    <li style="margin: 10px 0; padding: 10px; background: white; border-radius: 8px;">
                        📝 <strong>表单处理</strong> - 完整的表单验证和数据处理机制
                    </li>
                </ul>
            </div>
        </div>

        <div class="footer">
            <p>&copy; 2025 智能Web应用系统 | 让技术更有温度 ❤️</p>
        </div>
    </div>

    <script>
        // 实时更新时间
        function updateTime() {
            const now = new Date();
            const timeString = now.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            document.getElementById('currentTime').textContent = timeString;
        }

        // 立即更新一次，然后每秒更新
        updateTime();
        setInterval(updateTime, 1000);

        // 添加页面加载动画
        document.addEventListener('DOMContentLoaded', function() {
            const cards = document.querySelectorAll('.feature-card');
            cards.forEach((card, index) => {
                setTimeout(() => {
                    card.style.opacity = '0';
                    card.style.transform = 'translateY(20px)';
                    card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';

                    setTimeout(() => {
                        card.style.opacity = '1';
                        card.style.transform = 'translateY(0)';
                    }, 100);
                }, index * 200);
            });
        });

        console.log('🎉 欢迎来到智能Web应用系统！');
        console.log('🔧 技术栈: Java + Servlet + JSP + Maven');
        console.log('🚀 准备好探索更多功能了吗？');
    </script>
</body>
</html>
