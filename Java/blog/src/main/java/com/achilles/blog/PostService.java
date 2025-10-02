package com.achilles.blog;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class PostService {

    private final PostRepository postRepository;
    private final UserRepository userRepository;

    public PostService(PostRepository postRepository, UserRepository userRepository) {
        this.postRepository = postRepository;
        this.userRepository = userRepository;
    }

    /**
     * 创建文章
     */
    public Post createPost(Post post) {
        // 获取当前登录用户
        String currentUsername = getCurrentUsername();
        User currentUser = userRepository.findByUsername(currentUsername)
                .orElseThrow(() -> new ResourceNotFoundException("User not found: " + currentUsername));

        // 设置文章作者
        post.setAuthor(currentUser);
        return postRepository.save(post);
    }

    /**
     * 获取所有文章
     */
    public List<Post> getAllPosts() {
        return postRepository.findAll();
    }

    /**
     * 根据ID获取单篇文章
     */
    public Post getPostById(Long id) {
        return postRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Post not found with id: " + id));
    }

    /**
     * 更新文章
     */
    public Post updatePost(Long id, Post postDetails) {
        Post existingPost = postRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Post not found with id: " + id));

        // 权限检查：只有作者可以更新文章
        String currentUsername = getCurrentUsername();
        if (!existingPost.getAuthor().getUsername().equals(currentUsername)) {
            throw new AccessDeniedException("You can only update your own posts");
        }

        existingPost.setTitle(postDetails.getTitle());
        existingPost.setContent(postDetails.getContent());

        return postRepository.save(existingPost);
    }

    /**
     * 删除文章
     */
    public void deletePost(Long id) {
        Post existingPost = postRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Post not found with id: " + id));

        // 权限检查：只有作者可以删除文章
        String currentUsername = getCurrentUsername();
        if (!existingPost.getAuthor().getUsername().equals(currentUsername)) {
            throw new AccessDeniedException("You can only delete your own posts");
        }

        postRepository.deleteById(id);
    }

    /**
     * 获取当前登录用户的用户名
     */
    private String getCurrentUsername() {
        return SecurityContextHolder.getContext().getAuthentication().getName();
    }
}
