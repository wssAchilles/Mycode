package com.achilles.blog.security;

import com.achilles.blog.User;
import com.achilles.blog.UserRepository;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import java.util.ArrayList;
import java.lang.reflect.Field;

@Service
public class UserDetailsServiceImpl implements UserDetailsService {

    private final UserRepository userRepository;

    public UserDetailsServiceImpl(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new UsernameNotFoundException("User not found: " + username));

        // 由于password字段有@JsonIgnore注解，我们需要通过反射或直接字段访问
        return new org.springframework.security.core.userdetails.User(
                user.getUsername(),
                getPasswordFromUser(user),
                new ArrayList<>()
        );
    }

    private String getPasswordFromUser(User user) {
        try {
            Field passwordField = User.class.getDeclaredField("password");
            passwordField.setAccessible(true);
            return (String) passwordField.get(user);
        } catch (Exception e) {
            throw new RuntimeException("Cannot access password field", e);
        }
    }
}
