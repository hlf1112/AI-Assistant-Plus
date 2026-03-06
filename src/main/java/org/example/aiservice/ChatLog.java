package org.example.aiservice;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Entity
@Table(name = "ChatLogs")
@Data
public class ChatLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private Long userId;

    private String role; // "user" or "model"

    @Column(columnDefinition = "NVARCHAR(MAX)")
    private String content;

    private LocalDateTime createdAt = LocalDateTime.now();
}