package com.achilles.blog;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class CommentService {

    private final CommentRepository commentRepository;
    private final PostRepository postRepository;
    private final UserRepository userRepository;

    public CommentService(CommentRepository commentRepository, PostRepository postRepository, UserRepository userRepository) {
        this.commentRepository = commentRepository;
        this.postRepository = postRepository;
        this.userRepository = userRepository;
    }

    /**
     * 创建评论
     */
    public Comment createComment(Long postId, Comment comment) {
        // 首先根据postId找到对应的文章
        Post post = postRepository.findById(postId)
                .orElseThrow(() -> new ResourceNotFoundException("Post not found with id: " + postId));

        // 获取当前登录用户并设置为评论作者
        String currentUsername = getCurrentUsername();
        User currentUser = userRepository.findByUsername(currentUsername)
                .orElseThrow(() -> new ResourceNotFoundException("User not found: " + currentUsername));

        // 设置评论的文章和作者
        comment.setPost(post);
        comment.setAuthor(currentUser);

        // 保存并返回评论
        return commentRepository.save(comment);
    }

    /**
     * 获取某篇文章下的所有评论
     */
    public List<Comment> getCommentsByPostId(Long postId) {
        return commentRepository.findByPostId(postId);
    }

    /**
     * 删除评论（需要权限校验）
     */
    public void deleteComment(Long commentId) {
        Comment existingComment = commentRepository.findById(commentId)
                .orElseThrow(() -> new ResourceNotFoundException("Comment not found with id: " + commentId));

        // 权限检查：只有作者可以删除评论
        String currentUsername = getCurrentUsername();
        if (!existingComment.getAuthor().getUsername().equals(currentUsername)) {
            throw new AccessDeniedException("You can only delete your own comments");
        }

        commentRepository.deleteById(commentId);
    }

    /**
     * 获取当前登录用户的用户名
     */
    private String getCurrentUsername() {
        return SecurityContextHolder.getContext().getAuthentication().getName();
    }
}
