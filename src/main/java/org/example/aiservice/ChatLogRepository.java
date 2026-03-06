package org.example.aiservice;

import org.example.aiservice.ChatLog;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ChatLogRepository extends JpaRepository<ChatLog, Long> {
    // 查询某用户的最近 50 条记录
    List<ChatLog> findTop50ByUserIdOrderByCreatedAtDesc(Long userId);
}
