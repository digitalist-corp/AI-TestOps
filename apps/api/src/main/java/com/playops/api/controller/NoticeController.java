package com.playops.api.controller;

import com.playops.api.dto.NoticeDtos.Notice;
import com.playops.api.dto.NoticeDtos.NoticeRequest;
import com.playops.api.entity.User;
import com.playops.api.service.NoticeService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** 공지사항(#116). 읽기는 누구나, 쓰기는 관리자 (ProjectAccessInterceptor · NoticeService). */
@RestController
@RequestMapping("/api/notices")
public class NoticeController {

    private final NoticeService noticeService;

    public NoticeController(NoticeService noticeService) {
        this.noticeService = noticeService;
    }

    @GetMapping
    public List<Notice> list(HttpServletRequest request) {
        return noticeService.list(currentUser(request));
    }

    @GetMapping("/{id}")
    public Notice get(@PathVariable Long id, HttpServletRequest request) {
        return noticeService.get(id, currentUser(request));
    }

    @PostMapping
    public Notice create(@RequestBody NoticeRequest body, HttpServletRequest request) {
        return noticeService.create(body, currentUser(request));
    }

    @PutMapping("/{id}")
    public Notice update(@PathVariable Long id, @RequestBody NoticeRequest body, HttpServletRequest request) {
        return noticeService.update(id, body, currentUser(request));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id, HttpServletRequest request) {
        noticeService.delete(id, currentUser(request));
    }

    private static User currentUser(HttpServletRequest request) {
        return (User) request.getAttribute("currentUser");
    }
}
