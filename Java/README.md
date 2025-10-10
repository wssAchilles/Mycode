# Java 项目集合

这个目录包含多个基于Java技术栈开发的企业级应用项目，展示了现代Java开发的最佳实践和各种技术应用场景。

## 📁 项目结构

```
Java/
├── blog/                         # Spring Boot博客系统
│   ├── src/                     # 源代码
│   │   ├── main/java/com/achilles/blog/
│   │   │   ├── AuthController.java        # 认证控制器
│   │   │   ├── PostController.java        # 文章控制器
│   │   │   ├── CommentController.java     # 评论控制器
│   │   │   ├── security/                  # 安全配置
│   │   │   └── config/                    # 应用配置
│   │   └── resources/           # 配置文件
│   ├── build.gradle            # Gradle构建配置
│   └── HELP.md                 # 开发文档
├── urban-environment/           # 城市环境监测平台
│   ├── backend/                # Spring Boot后端
│   ├── frontend/               # Vue 3前端
│   ├── ai-service/             # Python AI服务
│   └── scripts/                # 辅助脚本
└── web/                        # Web开发示例
    └── (基础web项目文件)
```

## 🚀 项目概览

### 1. Blog 博客系统
**技术栈**: Spring Boot 3.2 + Spring Security + JWT + H2/MySQL + Lombok

**核心特性**:
- 🔐 **JWT认证系统** - 无状态身份认证
- 📝 **文章管理** - CRUD操作，支持分类和标签
- 💬 **评论系统** - 多层评论，支持回复
- 👥 **用户管理** - 注册、登录、个人资料
- 🛡️ **安全防护** - Spring Security集成
- 📊 **RESTful API** - 标准REST接口设计

**主要组件**:
```java
// 核心实体
├── User.java              # 用户实体
├── Post.java              # 文章实体  
├── Comment.java           # 评论实体

// 控制器层
├── AuthController.java    # 认证接口
├── PostController.java    # 文章接口
├── CommentController.java # 评论接口

// 安全模块
├── SecurityConfig.java    # 安全配置
├── JwtUtil.java          # JWT工具类
├── JwtAuthenticationFilter.java # JWT过滤器
└── UserDetailsServiceImpl.java # 用户详情服务
```

### 2. Urban Environment 城市环境监测平台
**技术栈**: Spring Boot + Vue 3 + TypeScript + PostgreSQL + Google Maps API + Python AI

**核心特性**:
- 🌍 **实时数据采集** - IoT传感器数据收集
- 📍 **地理信息可视化** - Google Maps集成
- 🤖 **AI异常检测** - Python机器学习模型
- 📊 **数据分析仪表盘** - 实时数据监控
- 🔄 **WebSocket实时推送** - 数据实时更新
- 📈 **历史数据分析** - 趋势分析和预测
- 🏗️ **容器化部署** - Docker Compose编排

**系统架构**:
```
┌─────────────────────────────────────────────┐
│                前端层 (Vue 3)                │
│  ┌─────────────────────────────────────┐    │
│  │     数据可视化 + 地图展示             │    │
│  └─────────────────────────────────────┘    │
├─────────────────────────────────────────────┤
│              API网关层 (Spring Boot)         │
│  ┌─────────────────┬─────────────────────┐  │
│  │   REST API      │   WebSocket服务     │  │
│  └─────────────────┴─────────────────────┘  │
├─────────────────────────────────────────────┤
│                业务逻辑层                    │
│  ┌─────────────────┬─────────────────────┐  │
│  │   数据处理      │   AI异常检测         │  │
│  │   (Java)        │   (Python)          │  │
│  └─────────────────┴─────────────────────┘  │
├─────────────────────────────────────────────┤
│                数据存储层                    │
│  ┌─────────────────┬─────────────────────┐  │
│  │   PostgreSQL    │   TimescaleDB       │  │
│  │   (关系数据)     │   (时序数据)        │  │
│  └─────────────────┴─────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 3. Web 开发示例
基础的Web开发模板和示例代码。

## 🛠️ 开发环境配置

### 系统要求
- **Java**: 21+ (推荐使用OpenJDK)
- **Gradle**: 8.0+
- **Node.js**: 18+ (用于前端项目)
- **PostgreSQL**: 15+ (用于城市环境项目)
- **Python**: 3.9+ (用于AI服务)

### 快速启动

#### 1. Blog 博客系统
```bash
cd Java/blog

# 编译和运行
./gradlew bootRun

# 访问应用
# API文档: http://localhost:8080/swagger-ui.html
# H2控制台: http://localhost:8080/h2-console
```

#### 2. 城市环境监测平台
```bash
cd Java/urban-environment

# 启动数据库
docker-compose up -d postgresql

# 启动后端服务
cd backend
./gradlew bootRun

# 启动前端应用
cd ../frontend  
npm install
npm run dev

# 启动AI服务
cd ../ai-service
pip install -r requirements.txt
python main.py

# 启动数据模拟器
cd ../scripts
python iot_simulator.py
```

## 📊 项目技术对比

| 项目 | 主要技术 | 应用场景 | 复杂度 | 特色功能 |
|------|----------|----------|--------|----------|
| Blog | Spring Boot + Security | 内容管理系统 | 中等 | JWT认证、评论系统 |
| Urban Environment | 全栈 + AI | IoT数据监控 | 高 | 实时数据、AI分析 |
| Web | 基础Web技术 | 学习示例 | 低 | 基础模板 |

## 🏗️ 架构设计模式

### 1. 分层架构 (Layered Architecture)
```java
// 控制器层 - 处理HTTP请求
@RestController
@RequestMapping("/api/posts")
public class PostController {
    @Autowired
    private PostService postService;
}

// 服务层 - 业务逻辑
@Service
@Transactional
public class PostService {
    @Autowired
    private PostRepository postRepository;
}

// 数据访问层 - 数据持久化
@Repository
public interface PostRepository extends JpaRepository<Post, Long> {
    List<Post> findByAuthorOrderByCreatedAtDesc(User author);
}
```

### 2. 微服务架构 (Microservices)
城市环境项目采用微服务设计：
- **数据采集服务** - Spring Boot
- **AI分析服务** - Python FastAPI
- **前端服务** - Vue 3 SPA
- **数据库服务** - PostgreSQL + TimescaleDB

### 3. 安全架构
```java
// JWT安全配置
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(session -> session.sessionCreationPolicy(STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
            .build();
    }
}
```

## 📝 API 接口设计

### Blog 系统 API
```yaml
# 认证接口
POST   /api/auth/register     # 用户注册
POST   /api/auth/login        # 用户登录
POST   /api/auth/refresh      # 刷新令牌

# 文章接口
GET    /api/posts             # 获取文章列表
POST   /api/posts             # 创建文章
GET    /api/posts/{id}        # 获取文章详情
PUT    /api/posts/{id}        # 更新文章
DELETE /api/posts/{id}        # 删除文章

# 评论接口
GET    /api/posts/{id}/comments    # 获取文章评论
POST   /api/posts/{id}/comments    # 添加评论
DELETE /api/comments/{id}          # 删除评论
```

### 城市环境系统 API
```yaml
# 传感器数据
POST   /api/data              # 接收传感器数据
GET    /api/data/latest       # 获取最新数据
GET    /api/data/history      # 获取历史数据

# AI分析
GET    /api/analysis/anomaly  # 获取异常检测结果
GET    /api/analysis/trend    # 获取趋势分析
POST   /api/analysis/predict  # 执行预测分析

# WebSocket
WS     /ws/realtime          # 实时数据推送
```

## 🔧 开发工具和最佳实践

### 开发工具配置
```gradle
// build.gradle 最佳实践
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.2.0'
    id 'io.spring.dependency-management' version '1.1.4'
    id 'org.sonarqube' version '4.0.0.2929'  // 代码质量检查
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.springframework.boot:spring-boot-starter-security'
    implementation 'org.springframework.boot:spring-boot-starter-validation'
    
    // 开发工具
    developmentOnly 'org.springframework.boot:spring-boot-devtools'
    
    // 文档生成
    implementation 'org.springdoc:springdoc-openapi-starter-webmvc-ui:2.0.2'
    
    // 测试框架
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
    testImplementation 'org.springframework.security:spring-security-test'
}
```

### 代码规范
- **命名规范**: 遵循Java命名约定
- **注释规范**: JavaDoc文档注释
- **异常处理**: 统一异常处理机制
- **日志规范**: SLF4J + Logback
- **测试覆盖**: 单元测试 + 集成测试

## 🧪 测试策略

### 单元测试示例
```java
@ExtendWith(MockitoExtension.class)
class PostServiceTest {
    
    @Mock
    private PostRepository postRepository;
    
    @InjectMocks
    private PostService postService;
    
    @Test
    void shouldCreatePostSuccessfully() {
        // Given
        Post post = new Post("Test Title", "Test Content");
        when(postRepository.save(any(Post.class))).thenReturn(post);
        
        // When
        Post result = postService.createPost(post);
        
        // Then
        assertThat(result.getTitle()).isEqualTo("Test Title");
        verify(postRepository).save(post);
    }
}
```

### 集成测试示例
```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.ANY)
class PostControllerIntegrationTest {
    
    @Autowired
    private TestRestTemplate restTemplate;
    
    @Test
    void shouldCreateAndRetrievePost() {
        // 创建文章
        Post post = new Post("Integration Test", "Content");
        ResponseEntity<Post> createResponse = restTemplate
            .postForEntity("/api/posts", post, Post.class);
        
        assertThat(createResponse.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        
        // 获取文章
        Long postId = createResponse.getBody().getId();
        ResponseEntity<Post> getResponse = restTemplate
            .getForEntity("/api/posts/" + postId, Post.class);
        
        assertThat(getResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(getResponse.getBody().getTitle()).isEqualTo("Integration Test");
    }
}
```

## 📈 性能优化

### 数据库优化
```java
// JPA查询优化
@Query("SELECT p FROM Post p JOIN FETCH p.author WHERE p.published = true")
List<Post> findPublishedPostsWithAuthor();

// 分页查询
Page<Post> findByTitleContaining(String title, Pageable pageable);

// 缓存配置
@Cacheable("posts")
public Post findById(Long id) {
    return postRepository.findById(id).orElse(null);
}
```

### 应用性能优化
```java
// 异步处理
@Async
@EventListener
public void handlePostCreated(PostCreatedEvent event) {
    // 异步发送邮件通知
    emailService.sendNotification(event.getPost());
}

// 连接池配置
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.minimum-idle=5
```

## 🚀 部署指南

### Docker 部署
```dockerfile
# Dockerfile for Spring Boot
FROM openjdk:21-jre-slim

COPY build/libs/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app.jar"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  blog-app:
    build: .
    ports:
      - "8080:8080"
    environment:
      - SPRING_PROFILES_ACTIVE=prod
      - SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/blog
    depends_on:
      - db
      
  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=blog
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data
```

## 📖 学习资源

### 官方文档
- [Spring Boot官方文档](https://spring.io/projects/spring-boot)
- [Spring Security文档](https://spring.io/projects/spring-security)
- [Vue 3官方文档](https://vuejs.org/)
- [PostgreSQL文档](https://www.postgresql.org/docs/)

### 推荐书籍
- 《Spring Boot实战》
- 《Java并发编程实战》
- 《微服务架构设计模式》
- 《Clean Code》

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 📄 许可证

本项目基于 MIT 许可证开源。详见各子项目的 LICENSE 文件。

---

**项目目标**: 展示现代Java企业级应用开发的最佳实践，涵盖Web开发、微服务架构、AI集成等多个技术领域，为Java开发者提供完整的学习和参考案例。
