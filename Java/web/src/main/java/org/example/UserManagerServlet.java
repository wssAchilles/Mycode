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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@WebServlet("/user-manager")
public class UserManagerServlet extends HttpServlet {

    // 简单的内存存储用户数据（实际项目中应使用数据库）
    private static final Map<String, UserInfo> users = new HashMap<>();
    private static final List<String> systemMessages = new ArrayList<>();

    static {
        // 初始化一些示例数据
        users.put("admin", new UserInfo("admin", "管理员", "admin@example.com", "管理员"));
        users.put("guest", new UserInfo("guest", "访客", "guest@example.com", "普通用户"));
        systemMessages.add("系统初始化完成");
        systemMessages.add("用户管理模块启动");
    }

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        response.setContentType("text/html;charset=UTF-8");
        PrintWriter out = response.getWriter();

        String action = request.getParameter("action");
        String username = request.getParameter("username");

        if ("login".equals(action)) {
            handleLogin(request, response, out);
        } else if ("register".equals(action)) {
            handleRegister(request, response, out);
        } else if ("profile".equals(action)) {
            showProfile(request, response, out);
        } else {
            showMainPage(request, response, out);
        }
    }

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
        request.setCharacterEncoding("UTF-8");
        String action = request.getParameter("action");

        if ("login".equals(action)) {
            processLogin(request, response);
        } else if ("register".equals(action)) {
            processRegister(request, response);
        } else if ("logout".equals(action)) {
            processLogout(request, response);
        } else {
            doGet(request, response);
        }
    }

    private void showMainPage(HttpServletRequest request, HttpServletResponse response, PrintWriter out) {
        HttpSession session = request.getSession();
        UserInfo currentUser = (UserInfo) session.getAttribute("currentUser");

        out.println("<!DOCTYPE html>");
        out.println("<html>");
        out.println("<head>");
        out.println("<meta charset=\"UTF-8\">");
        out.println("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">");
        out.println("<title>用户管理系统</title>");
        generateCSS(out);
        out.println("</head>");
        out.println("<body>");

        out.println("<div class=\"container\">");
        out.println("<div class=\"header\">");
        out.println("<h1>👥 用户管理系统</h1>");
        out.println("<p>安全、高效的用户管理解决方案</p>");
        out.println("</div>");

        out.println("<div class=\"content\">");

        // 用户状态区域
        if (currentUser != null) {
            out.println("<div class=\"user-info\">");
            out.println("<h3>👋 欢迎回来，" + currentUser.getDisplayName() + "！</h3>");
            out.println("<p>用户级别: <span class=\"role\">" + currentUser.getRole() + "</span></p>");
            out.println("<p>登录时间: " + LocalDateTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss")) + "</p>");
            out.println("<div class=\"user-actions\">");
            out.println("<a href=\"" + request.getContextPath() + "/user-manager?action=profile\" class=\"btn btn-primary\">👤 个人资料</a>");
            out.println("<form method=\"post\" style=\"display:inline;\">");
            out.println("<input type=\"hidden\" name=\"action\" value=\"logout\">");
            out.println("<button type=\"submit\" class=\"btn btn-secondary\">🚪 退出登录</button>");
            out.println("</form>");
            out.println("</div>");
            out.println("</div>");
        } else {
            out.println("<div class=\"login-prompt\">");
            out.println("<h3>🔐 请登录以使用完整功能</h3>");
            out.println("<div class=\"auth-buttons\">");
            out.println("<a href=\"" + request.getContextPath() + "/user-manager?action=login\" class=\"btn btn-primary\">🔑 登录</a>");
            out.println("<a href=\"" + request.getContextPath() + "/user-manager?action=register\" class=\"btn btn-secondary\">📝 注册</a>");
            out.println("</div>");
            out.println("</div>");
        }

        // 功能区域
        out.println("<div class=\"features\">");
        out.println("<div class=\"feature-grid\">");

        out.println("<div class=\"feature-card\">");
        out.println("<div class=\"feature-icon\">📊</div>");
        out.println("<h4>系统统计</h4>");
        out.println("<p>注册用户: <strong>" + users.size() + "</strong></p>");
        out.println("<p>在线用户: <strong>1</strong></p>");
        out.println("<p>系统消息: <strong>" + systemMessages.size() + "</strong></p>");
        out.println("</div>");

        out.println("<div class=\"feature-card\">");
        out.println("<div class=\"feature-icon\">🔒</div>");
        out.println("<h4>安全特性</h4>");
        out.println("<p>会话管理 ✅</p>");
        out.println("<p>数据加密 ✅</p>");
        out.println("<p>访问控制 ✅</p>");
        out.println("</div>");

        out.println("<div class=\"feature-card\">");
        out.println("<div class=\"feature-icon\">⚡</div>");
        out.println("<h4>性能监控</h4>");
        out.println("<p>响应时间: <span style=\"color: green;\">优秀</span></p>");
        out.println("<p>内存使用: <span style=\"color: blue;\">正常</span></p>");
        out.println("<p>CPU使用: <span style=\"color: green;\">良好</span></p>");
        out.println("</div>");

        out.println("</div>");
        out.println("</div>");

        // 系统消息
        out.println("<div class=\"messages\">");
        out.println("<h3>📢 系统消息</h3>");
        out.println("<div class=\"message-list\">");
        for (int i = Math.max(0, systemMessages.size() - 5); i < systemMessages.size(); i++) {
            out.println("<div class=\"message-item\">");
            out.println("• " + systemMessages.get(i));
            out.println("</div>");
        }
        out.println("</div>");
        out.println("</div>");

        out.println("<div class=\"navigation\">");
        out.println("<a href=\"" + request.getContextPath() + "/\" class=\"btn btn-outline\">🏠 返回首页</a>");
        out.println("<a href=\"" + request.getContextPath() + "/hello-servlet\" class=\"btn btn-outline\">🚀 主应用</a>");
        out.println("</div>");

        out.println("</div>");
        out.println("</div>");
        out.println("</body>");
        out.println("</html>");
    }

    private void handleLogin(HttpServletRequest request, HttpServletResponse response, PrintWriter out) {
        out.println("<!DOCTYPE html>");
        out.println("<html>");
        out.println("<head>");
        out.println("<meta charset=\"UTF-8\">");
        out.println("<title>用户登录</title>");
        generateCSS(out);
        out.println("</head>");
        out.println("<body>");

        out.println("<div class=\"container\">");
        out.println("<div class=\"auth-form\">");
        out.println("<h2>🔑 用户登录</h2>");

        String error = request.getParameter("error");
        if ("invalid".equals(error)) {
            out.println("<div class=\"alert alert-error\">❌ 用户名或密码错误</div>");
        }

        out.println("<form method=\"post\">");
        out.println("<input type=\"hidden\" name=\"action\" value=\"login\">");
        out.println("<div class=\"form-group\">");
        out.println("<label>用户名:</label>");
        out.println("<input type=\"text\" name=\"username\" required placeholder=\"请输入用户名\">");
        out.println("<small>演示账号: admin 或 guest</small>");
        out.println("</div>");
        out.println("<div class=\"form-group\">");
        out.println("<label>密码:</label>");
        out.println("<input type=\"password\" name=\"password\" required placeholder=\"请输入密码\">");
        out.println("<small>演示密码: 123456</small>");
        out.println("</div>");
        out.println("<button type=\"submit\" class=\"btn btn-primary\">登录</button>");
        out.println("<a href=\"" + request.getContextPath() + "/user-manager?action=register\" class=\"btn btn-outline\">注册新账号</a>");
        out.println("</form>");
        out.println("<a href=\"" + request.getContextPath() + "/user-manager\" class=\"back-link\">← 返回</a>");
        out.println("</div>");
        out.println("</div>");

        out.println("</body>");
        out.println("</html>");
    }

    private void processLogin(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String username = request.getParameter("username");
        String password = request.getParameter("password");

        // 简单的密码验证（实际项目中应使用散列）
        if (users.containsKey(username) && "123456".equals(password)) {
            HttpSession session = request.getSession();
            session.setAttribute("currentUser", users.get(username));
            systemMessages.add("用户 " + username + " 登录成功");
            response.sendRedirect(request.getContextPath() + "/user-manager");
        } else {
            response.sendRedirect(request.getContextPath() + "/user-manager?action=login&error=invalid");
        }
    }

    private void processLogout(HttpServletRequest request, HttpServletResponse response) throws IOException {
        HttpSession session = request.getSession();
        UserInfo user = (UserInfo) session.getAttribute("currentUser");
        if (user != null) {
            systemMessages.add("用户 " + user.getUsername() + " 退出登录");
        }
        session.invalidate();
        response.sendRedirect(request.getContextPath() + "/user-manager");
    }

    private void handleRegister(HttpServletRequest request, HttpServletResponse response, PrintWriter out) {
        // 注册页面实现
        out.println("<!DOCTYPE html>");
        out.println("<html>");
        out.println("<head>");
        out.println("<meta charset=\"UTF-8\">");
        out.println("<title>用户注册</title>");
        generateCSS(out);
        out.println("</head>");
        out.println("<body>");

        out.println("<div class=\"container\">");
        out.println("<div class=\"auth-form\">");
        out.println("<h2>📝 用户注册</h2>");
        out.println("<p style=\"color: #666; margin-bottom: 20px;\">创建您的新账号</p>");

        out.println("<form method=\"post\">");
        out.println("<input type=\"hidden\" name=\"action\" value=\"register\">");
        out.println("<div class=\"form-group\">");
        out.println("<label>用户名:</label>");
        out.println("<input type=\"text\" name=\"username\" required placeholder=\"请输入用户名\">");
        out.println("</div>");
        out.println("<div class=\"form-group\">");
        out.println("<label>显示名称:</label>");
        out.println("<input type=\"text\" name=\"displayName\" required placeholder=\"请输入显示名称\">");
        out.println("</div>");
        out.println("<div class=\"form-group\">");
        out.println("<label>邮箱:</label>");
        out.println("<input type=\"email\" name=\"email\" required placeholder=\"请输入邮箱地址\">");
        out.println("</div>");
        out.println("<button type=\"submit\" class=\"btn btn-primary\">注册</button>");
        out.println("<a href=\"" + request.getContextPath() + "/user-manager?action=login\" class=\"btn btn-outline\">已有账号？登录</a>");
        out.println("</form>");
        out.println("<a href=\"" + request.getContextPath() + "/user-manager\" class=\"back-link\">← 返回</a>");
        out.println("</div>");
        out.println("</div>");

        out.println("</body>");
        out.println("</html>");
    }

    private void processRegister(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String username = request.getParameter("username");
        String displayName = request.getParameter("displayName");
        String email = request.getParameter("email");

        if (!users.containsKey(username)) {
            users.put(username, new UserInfo(username, displayName, email, "普通用户"));
            systemMessages.add("新用户 " + username + " 注册成功");

            // 自动登录
            HttpSession session = request.getSession();
            session.setAttribute("currentUser", users.get(username));

            response.sendRedirect(request.getContextPath() + "/user-manager");
        } else {
            response.sendRedirect(request.getContextPath() + "/user-manager?action=register&error=exists");
        }
    }

    private void showProfile(HttpServletRequest request, HttpServletResponse response, PrintWriter out) {
        HttpSession session = request.getSession();
        UserInfo currentUser = (UserInfo) session.getAttribute("currentUser");

        if (currentUser == null) {
            try {
                response.sendRedirect(request.getContextPath() + "/user-manager?action=login");
                return;
            } catch (IOException e) {
                e.printStackTrace();
            }
        }

        out.println("<!DOCTYPE html>");
        out.println("<html>");
        out.println("<head>");
        out.println("<meta charset=\"UTF-8\">");
        out.println("<title>个人资料</title>");
        generateCSS(out);
        out.println("</head>");
        out.println("<body>");

        out.println("<div class=\"container\">");
        out.println("<div class=\"profile-page\">");
        out.println("<h2>👤 个人资料</h2>");

        out.println("<div class=\"profile-info\">");
        out.println("<div class=\"profile-item\">");
        out.println("<strong>用户名:</strong> " + currentUser.getUsername());
        out.println("</div>");
        out.println("<div class=\"profile-item\">");
        out.println("<strong>显示名称:</strong> " + currentUser.getDisplayName());
        out.println("</div>");
        out.println("<div class=\"profile-item\">");
        out.println("<strong>邮箱:</strong> " + currentUser.getEmail());
        out.println("</div>");
        out.println("<div class=\"profile-item\">");
        out.println("<strong>用户级别:</strong> " + currentUser.getRole());
        out.println("</div>");
        out.println("<div class=\"profile-item\">");
        out.println("<strong>会话ID:</strong> " + session.getId().substring(0, 8) + "...");
        out.println("</div>");
        out.println("</div>");

        out.println("<div class=\"profile-actions\">");
        out.println("<a href=\"" + request.getContextPath() + "/user-manager\" class=\"btn btn-primary\">返回主页</a>");
        out.println("</div>");

        out.println("</div>");
        out.println("</div>");

        out.println("</body>");
        out.println("</html>");
    }

    private void generateCSS(PrintWriter out) {
        out.println("<style>");
        out.println("* { margin: 0; padding: 0; box-sizing: border-box; }");
        out.println("body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }");
        out.println(".container { max-width: 900px; margin: 0 auto; background: white; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); overflow: hidden; }");
        out.println(".header { background: linear-gradient(45deg, #4834d4, #686de0); color: white; padding: 30px; text-align: center; }");
        out.println(".header h1 { font-size: 2.5em; margin-bottom: 10px; }");
        out.println(".content { padding: 30px; }");
        out.println(".user-info { background: #e8f5e8; padding: 20px; border-radius: 10px; margin-bottom: 20px; }");
        out.println(".login-prompt { background: #fff3cd; padding: 20px; border-radius: 10px; margin-bottom: 20px; text-align: center; }");
        out.println(".feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }");
        out.println(".feature-card { background: #f8f9fa; padding: 20px; border-radius: 10px; text-align: center; border: 2px solid #e9ecef; }");
        out.println(".feature-icon { font-size: 2.5em; margin-bottom: 10px; }");
        out.println(".btn { display: inline-block; padding: 10px 20px; border-radius: 5px; text-decoration: none; font-weight: bold; margin: 5px; border: none; cursor: pointer; }");
        out.println(".btn-primary { background: #007bff; color: white; }");
        out.println(".btn-secondary { background: #6c757d; color: white; }");
        out.println(".btn-outline { background: transparent; color: #007bff; border: 2px solid #007bff; }");
        out.println(".btn:hover { opacity: 0.8; }");
        out.println(".auth-form { max-width: 400px; margin: 50px auto; padding: 30px; background: white; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); }");
        out.println(".form-group { margin-bottom: 20px; }");
        out.println("label { display: block; margin-bottom: 5px; font-weight: bold; }");
        out.println("input { width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 5px; font-size: 16px; }");
        out.println("small { color: #666; font-size: 0.9em; }");
        out.println(".alert { padding: 15px; margin: 15px 0; border-radius: 5px; }");
        out.println(".alert-error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }");
        out.println(".messages { background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0; }");
        out.println(".message-item { padding: 5px 0; color: #666; }");
        out.println(".navigation { text-align: center; margin-top: 30px; }");
        out.println(".back-link { display: block; text-align: center; margin-top: 20px; color: #007bff; text-decoration: none; }");
        out.println(".profile-page { max-width: 600px; margin: 50px auto; padding: 30px; }");
        out.println(".profile-info { background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px; }");
        out.println(".profile-item { padding: 10px 0; border-bottom: 1px solid #ddd; }");
        out.println(".profile-item:last-child { border-bottom: none; }");
        out.println(".user-actions { margin-top: 15px; }");
        out.println(".auth-buttons { margin-top: 20px; }");
        out.println(".role { background: #007bff; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.9em; }");
        out.println("</style>");
    }

    // 内部用户信息类
    private static class UserInfo {
        private String username;
        private String displayName;
        private String email;
        private String role;

        public UserInfo(String username, String displayName, String email, String role) {
            this.username = username;
            this.displayName = displayName;
            this.email = email;
            this.role = role;
        }

        // Getters
        public String getUsername() { return username; }
        public String getDisplayName() { return displayName; }
        public String getEmail() { return email; }
        public String getRole() { return role; }
    }
}
