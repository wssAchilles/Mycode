// 主要JavaScript功能

document.addEventListener('DOMContentLoaded', function() {
    // 自动隐藏提示消息
    const alerts = document.querySelectorAll('.alert');
    alerts.forEach(function(alert) {
        setTimeout(function() {
            alert.style.opacity = '0';
            setTimeout(function() {
                alert.remove();
            }, 300);
        }, 5000);
    });

    // 确认删除对话框
    const deleteButtons = document.querySelectorAll('[data-confirm-delete]');
    deleteButtons.forEach(function(button) {
        button.addEventListener('click', function(e) {
            const message = this.getAttribute('data-confirm-delete') || '确定要删除吗？';
            if (!confirm(message)) {
                e.preventDefault();
            }
        });
    });

    // 字符计数器
    const textareas = document.querySelectorAll('textarea[data-max-length]');
    textareas.forEach(function(textarea) {
        const maxLength = parseInt(textarea.getAttribute('data-max-length'));
        const counter = document.createElement('small');
        counter.className = 'text-muted character-counter';
        textarea.parentNode.appendChild(counter);
        
        function updateCounter() {
            const remaining = maxLength - textarea.value.length;
            counter.textContent = `还可输入 ${remaining} 个字符`;
            if (remaining < 0) {
                counter.className = 'text-danger character-counter';
            } else {
                counter.className = 'text-muted character-counter';
            }
        }
        
        textarea.addEventListener('input', updateCounter);
        updateCounter();
    });

    // 搜索建议
    const searchInput = document.querySelector('input[name="q"]');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            const query = this.value.trim();
            
            if (query.length >= 2) {
                searchTimeout = setTimeout(function() {
                    // 这里可以添加AJAX搜索建议功能
                    console.log('搜索建议:', query);
                }, 300);
            }
        });
    }

    // 点赞功能
    const likeButtons = document.querySelectorAll('.like-button');
    likeButtons.forEach(function(button) {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            const postId = this.getAttribute('data-post-id');
            
            fetch(`/api/v1/posts/${postId}/like`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + localStorage.getItem('access_token')
                }
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    const count = this.querySelector('.like-count');
                    count.textContent = data.likes;
                    this.classList.toggle('liked');
                }
            })
            .catch(error => {
                console.error('点赞失败:', error);
            });
        });
    });

    // 图片懒加载
    const images = document.querySelectorAll('img[data-src]');
    const imageObserver = new IntersectionObserver(function(entries, observer) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.getAttribute('data-src');
                img.removeAttribute('data-src');
                img.classList.remove('lazy');
                observer.unobserve(img);
            }
        });
    });
    
    images.forEach(function(img) {
        imageObserver.observe(img);
    });

    // 返回顶部按钮
    const backToTopButton = document.createElement('button');
    backToTopButton.innerHTML = '<i class="fas fa-arrow-up"></i>';
    backToTopButton.className = 'btn btn-primary position-fixed';
    backToTopButton.style.cssText = `
        bottom: 20px;
        right: 20px;
        z-index: 1000;
        border-radius: 50%;
        width: 50px;
        height: 50px;
        display: none;
    `;
    document.body.appendChild(backToTopButton);

    window.addEventListener('scroll', function() {
        if (window.pageYOffset > 300) {
            backToTopButton.style.display = 'block';
        } else {
            backToTopButton.style.display = 'none';
        }
    });

    backToTopButton.addEventListener('click', function() {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    // 主题切换（如果需要）
    const themeToggle = document.querySelector('#theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', function() {
            document.body.classList.toggle('dark-theme');
            const isDark = document.body.classList.contains('dark-theme');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });

        // 加载保存的主题
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-theme');
        }
    }

    // 表单验证增强
    const forms = document.querySelectorAll('form[data-validate]');
    forms.forEach(function(form) {
        form.addEventListener('submit', function(e) {
            const inputs = form.querySelectorAll('input[required], textarea[required]');
            let isValid = true;

            inputs.forEach(function(input) {
                if (!input.value.trim()) {
                    input.classList.add('is-invalid');
                    isValid = false;
                } else {
                    input.classList.remove('is-invalid');
                }
            });

            if (!isValid) {
                e.preventDefault();
            }
        });
    });

    // 实时保存草稿（对于文章编辑）
    const contentTextarea = document.querySelector('#content');
    if (contentTextarea) {
        let saveTimeout;
        contentTextarea.addEventListener('input', function() {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(function() {
                const content = contentTextarea.value;
                const title = document.querySelector('#title')?.value || '';
                
                if (content.length > 100) {
                    localStorage.setItem('draft', JSON.stringify({
                        title: title,
                        content: content,
                        timestamp: new Date().toISOString()
                    }));
                }
            }, 2000);
        });

        // 加载草稿
        const draft = localStorage.getItem('draft');
        if (draft && !contentTextarea.value) {
            const draftData = JSON.parse(draft);
            const draftTime = new Date(draftData.timestamp);
            const now = new Date();
            const hoursDiff = (now - draftTime) / (1000 * 60 * 60);

            if (hoursDiff < 24) {
                if (confirm('发现本地草稿，是否加载？')) {
                    contentTextarea.value = draftData.content;
                    const titleInput = document.querySelector('#title');
                    if (titleInput) {
                        titleInput.value = draftData.title;
                    }
                }
            }
        }
    }
});

// 工具函数
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    notification.style.cssText = 'top: 20px; right: 20px; z-index: 1050; min-width: 300px;';
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(function() {
        notification.remove();
    }, 5000);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN');
}

// 导出函数供其他脚本使用
window.AppUtils = {
    showNotification,
    formatDate
};
