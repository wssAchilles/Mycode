package org.example;

import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;
import java.io.PrintWriter;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.atomic.AtomicInteger;

@WebServlet("/hello-servlet")
public class HelloServlet extends HttpServlet {

    // 静态变量用于统计访问次数
    private static final AtomicInteger visitCount = new AtomicInteger(0);
    private static final AtomicInteger userCount = new AtomicInteger(0);

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        // 增加访问计数
        int currentVisits = visitCount.incrementAndGet();

        // 会话管理
        HttpSession session = request.getSession(true);
        boolean isNewUser = session.isNew();
        if (isNewUser) {
            userCount.incrementAndGet();
        }

        response.setContentType("text/html;charset=UTF-8");//网页编码器改为UTF-8
        PrintWriter out = response.getWriter();

        // 获取请求参数
        String name = request.getParameter("name");
        String action = request.getParameter("action");
        String message = request.getParameter("message");

        // 生成页面
        generateHtmlPage(out, request, name, action, message, currentVisits, isNewUser);
    }

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        // 处理表单提交
        request.setCharacterEncoding("UTF-8");

        String name = request.getParameter("username");
        String email = request.getParameter("email");
        String message = request.getParameter("message");
        String feedback = request.getParameter("feedback");

        // 将处理结果传递给GET方法显示
        request.setAttribute("formSubmitted", true);
        request.setAttribute("submittedName", name);
        request.setAttribute("submittedEmail", email);
        request.setAttribute("submittedMessage", message);
        request.setAttribute("submittedFeedback", feedback);

        doGet(request, response);
    }

    private void generateHtmlPage(PrintWriter out, HttpServletRequest request, String name,
                                 String action, String message, int visitCount, boolean isNewUser) {

        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy年MM月dd日 HH:mm:ss");
        String currentTime = LocalDateTime.now().format(formatter);

        out.println("<!DOCTYPE html>");
        out.println("<html>");
        out.println("<head>");
        out.println("<meta charset=\"UTF-8\">");
        out.println("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
        out.println("<title>智能交互 Servlet 系统</title>");

        // 增强的CSS样式
        out.println("<style>");
        out.println("* { margin: 0; padding: 0; box-sizing: border-box; }");
        out.println("body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }");
        out.println(".container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); overflow: hidden; }");
        out.println(".header { background: linear-gradient(45deg, #007bff, #0056b3); color: white; padding: 30px; text-align: center; }");
        out.println(".header h1 { font-size: 2.5em; margin-bottom: 10px; }");
        out.println(".header p { font-size: 1.2em; opacity: 0.9; }");
        out.println(".content { padding: 30px; }");
        out.println(".info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }");
        out.println(".info-card { background: #f8f9fa; padding: 20px; border-radius: 10px; border-left: 4px solid #007bff; }");
        out.println(".info-card h3 { color: #007bff; margin-bottom: 10px; }");
        out.println(".form-section { background: #f8f9fa; padding: 25px; border-radius: 10px; margin: 20px 0; }");
        out.println(".form-group { margin-bottom: 15px; }");
        out.println("label { display: block; margin-bottom: 5px; font-weight: bold; color: #333; }");
        out.println("input, textarea, select { width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 5px; font-size: 16px; }");
        out.println("input:focus, textarea:focus { border-color: #007bff; outline: none; }");
        out.println("button { background: #007bff; color: white; padding: 12px 25px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; margin: 5px; }");
        out.println("button:hover { background: #0056b3; }");
        out.println(".alert { padding: 15px; margin: 15px 0; border-radius: 5px; }");
        out.println(".alert-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }");
        out.println(".alert-info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }");
        out.println(".quick-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0; }");
        out.println(".stats { display: flex; justify-content: space-around; background: #e9ecef; padding: 15px; border-radius: 10px; margin: 20px 0; }");
        out.println(".stat-item { text-align: center; }");
        out.println(".stat-number { font-size: 2em; font-weight: bold; color: #007bff; }");
        out.println(".footer { background: #343a40; color: white; text-align: center; padding: 20px; }");
        out.println("</style>");
        out.println("</head>");
        out.println("<body>");

        out.println("<div class=\"container\">");

        // 头部
        out.println("<div class=\"header\">");
        out.println("<h1>🚀 智能交互 Servlet 系统</h1>");
        out.println("<p>欢迎来到功能强大的 Web 应用程序</p>");
        out.println("</div>");

        out.println("<div class=\"content\">");

        // 统计信息
        out.println("<div class=\"stats\">");
        out.println("<div class=\"stat-item\">");
        out.println("<div class=\"stat-number\">" + visitCount + "</div>");
        out.println("<div>总访问次数</div>");
        out.println("</div>");
        out.println("<div class=\"stat-item\">");
        out.println("<div class=\"stat-number\">" + userCount.get() + "</div>");
        out.println("<div>独立用户</div>");
        out.println("</div>");
        out.println("<div class=\"stat-item\">");
        out.println("<div class=\"stat-number\">" + currentTime + "</div>");
        out.println("<div>当前时间</div>");
        out.println("</div>");
        out.println("</div>");

        // 用户状态提示
        if (isNewUser) {
            out.println("<div class=\"alert alert-info\">");
            out.println("🎉 欢迎新用户！这是您第一次访问我们的系统。");
            out.println("</div>");
        }

        // 处理表单提交结果
        Boolean formSubmitted = (Boolean) request.getAttribute("formSubmitted");
        if (formSubmitted != null && formSubmitted) {
            out.println("<div class=\"alert alert-success\">");
            out.println("✅ 表单提交成功！感谢您的反馈。");
            out.println("<br>姓名: " + request.getAttribute("submittedName"));
            out.println("<br>邮箱: " + request.getAttribute("submittedEmail"));
            out.println("</div>");
        }

        // 个性化问候
        out.println("<div class=\"info-grid\">");
        out.println("<div class=\"info-card\">");
        out.println("<h3>👋 个性化问候</h3>");
        if (name != null && !name.isEmpty()) {
            out.println("<p>你好，<strong>" + name + "</strong>！</p>");
            out.println("<p>很高兴见到您！</p>");
        } else {
            out.println("<p>您还没有告诉我您的名字。</p>");
            out.println("<p><a href=\"" + request.getContextPath() + "/hello-servlet?name=张三\">点击这里试试</a></p>");
        }
        out.println("</div>");

        out.println("<div class=\"info-card\">");
        out.println("<h3>📊 系统信息</h3>");
        out.println("<p>服务器状态: <span style=\"color: green;\">正常运行</span></p>");
        out.println("<p>响应时间: <span style=\"color: blue;\">< 100ms</span></p>");
        out.println("<p>会话ID: " + request.getSession().getId().substring(0, 8) + "...</p>");
        out.println("</div>");
        out.println("</div>");

        // 快速操作按钮
        out.println("<div class=\"quick-actions\">");
        out.println("<button onclick=\"window.location.href='" + request.getContextPath() + "/hello-servlet?action=time'\">🕒 获取时间</button>");
        out.println("<button onclick=\"window.location.href='" + request.getContextPath() + "/hello-servlet?action=info'\">ℹ️ 系统信息</button>");
        out.println("<button onclick=\"window.location.href='" + request.getContextPath() + "/hello-servlet?name=访客'\">👤 游客模式</button>");
        out.println("<button onclick=\"window.location.href='" + request.getContextPath() + "'\">🏠 返回首页</button>");
        out.println("</div>");

        // 交互式表单
        out.println("<div class=\"form-section\">");
        out.println("<h3>💬 用户反馈表单</h3>");
        out.println("<form method=\"post\" action=\"" + request.getContextPath() + "/hello-servlet\">");
        out.println("<div class=\"form-group\">");
        out.println("<label for=\"username\">姓名:</label>");
        out.println("<input type=\"text\" id=\"username\" name=\"username\" placeholder=\"请输入您的姓名\" required>");
        out.println("</div>");
        out.println("<div class=\"form-group\">");
        out.println("<label for=\"email\">邮箱:</label>");
        out.println("<input type=\"email\" id=\"email\" name=\"email\" placeholder=\"your@email.com\">");
        out.println("</div>");
        out.println("<div class=\"form-group\">");
        out.println("<label for=\"feedback\">反馈类型:</label>");
        out.println("<select id=\"feedback\" name=\"feedback\">");
        out.println("<option value=\"suggestion\">建议</option>");
        out.println("<option value=\"bug\">错误报告</option>");
        out.println("<option value=\"praise\">表扬</option>");
        out.println("<option value=\"other\">其他</option>");
        out.println("</select>");
        out.println("</div>");
        out.println("<div class=\"form-group\">");
        out.println("<label for=\"message\">详细信息:</label>");
        out.println("<textarea id=\"message\" name=\"message\" rows=\"4\" placeholder=\"请详细描述您的反馈...\"></textarea>");
        out.println("</div>");
        out.println("<button type=\"submit\">📤 提交反馈</button>");
        out.println("<button type=\"reset\">🔄 重置表单</button>");
        out.println("</form>");
        out.println("</div>");

        // 动态内容区域
        if ("time".equals(action)) {
            out.println("<div class=\"alert alert-info\">");
            out.println("🕐 当前详细时间: " + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy年MM月dd日 EEEE HH:mm:ss")));
            out.println("</div>");
        } else if ("info".equals(action)) {
            out.println("<div class=\"alert alert-info\">");
            out.println("💻 系统详细信息:<br>");
            out.println("Java版本: " + System.getProperty("java.version") + "<br>");
            out.println("操作系统: " + System.getProperty("os.name") + "<br>");
            out.println("服务器信息: Apache Tomcat");
            out.println("</div>");
        }

        out.println("</div>");

        // 页脚
        out.println("<div class=\"footer\">");
        out.println("<p>&copy; 2025 智能Servlet系统 | 由 <strong>HelloServlet</strong> 强力驱动</p>");
        out.println("</div>");

        out.println("</div>");

        // JavaScript增强
        out.println("<script>");
        out.println("console.log('欢迎来到智能Servlet系统！');");
        out.println("// 表单验证");
        out.println("document.querySelector('form').addEventListener('submit', function(e) {");
        out.println("    const name = document.getElementById('username').value;");
        out.println("    if (name.length < 2) {");
        out.println("        alert('姓名至少需要2个字符');");
        out.println("        e.preventDefault();");
        out.println("    }");
        out.println("});");
        out.println("</script>");

        out.println("</body>");
        out.println("</html>");
    }
}

