import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarClock,
  Edit,
  Eye,
  EyeOff,
  Heart,
  Megaphone,
  MessageSquareText,
  Paperclip,
  Plus,
  RefreshCw,
  Reply,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { api, getStoredAuth } from '@/api/client';
import type { BoardAttachment, BoardPost, BoardPostComment, BoardPostFormData, BoardPostType } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';

type BoardFilter = BoardPostType | 'ALL';

const typeLabel: Record<BoardPostType, string> = {
  REQUEST: '요청',
  QUESTION: '질문',
  FAQ: 'FAQ',
  FREE: '자유',
  NOTICE: '공지',
  ETC: '기타',
};

const typeTone: Record<BoardPostType, string> = {
  REQUEST: 'bg-primary/10 text-primary',
  QUESTION: 'bg-warning/10 text-warning',
  FAQ: 'bg-success/10 text-success',
  FREE: 'bg-muted text-muted-foreground',
  NOTICE: 'bg-destructive/10 text-destructive',
  ETC: 'bg-ai-accent/10 text-ai-accent',
};

function emptyForm(admin: boolean): BoardPostFormData {
  return {
    type: admin ? 'NOTICE' : 'FREE',
    title: '',
    parentId: null,
    content: '',
    attachments: [],
    visible: false,
    pinned: admin,
    visibleFrom: null,
    visibleUntil: null,
  };
}

function formatDate(value?: string | null): string {
  return value ? new Date(value).toLocaleString('ko-KR') : '-';
}

function toDateTimeLocal(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function formatFileSize(size?: number | null): string {
  if (!size || size <= 0) return '-';
  const units = ['B', 'KiB', 'MiB'];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[index]}`;
}

async function filesToAttachments(files: FileList | null): Promise<BoardAttachment[]> {
  if (!files?.length) return [];
  const selected = Array.from(files).slice(0, 5);
  return Promise.all(
    selected.map(
      (file) =>
        new Promise<BoardAttachment>((resolve, reject) => {
          if (file.size > 5 * 1024 * 1024) {
            reject(new Error('첨부파일은 파일당 5MiB 이하만 가능합니다.'));
            return;
          }
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              name: file.name,
              contentType: file.type || 'application/octet-stream',
              size: file.size,
              dataUrl: String(reader.result),
            });
          reader.onerror = () => reject(new Error('첨부파일을 읽지 못했습니다.'));
          reader.readAsDataURL(file);
        })
    )
  );
}

export function BoardPage() {
  const auth = getStoredAuth();
  const admin = auth?.role === 'ADMIN';
  const username = auth?.username ?? '';
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [allPosts, setAllPosts] = useState<BoardPost[]>([]);
  const [comments, setComments] = useState<BoardPostComment[]>([]);
  const [filter, setFilter] = useState<BoardFilter>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPost, setSelectedPost] = useState<BoardPost | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<BoardPost | null>(null);
  const [replyTargetPost, setReplyTargetPost] = useState<BoardPost | null>(null);
  const [form, setForm] = useState<BoardPostFormData>(emptyForm(admin));
  const [showExposureSettings, setShowExposureSettings] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentAttachments, setCommentAttachments] = useState<BoardAttachment[]>([]);
  const [replyTo, setReplyTo] = useState<BoardPostComment | null>(null);
  const [memoDraft, setMemoDraft] = useState('');
  const [error, setError] = useState('');

  const loadPosts = useCallback(async (clearSelection = false) => {
    setLoading(true);
    try {
      const [nextPosts, nextAllPosts] = await Promise.all([
        api.getBoardPosts(filter, admin),
        api.getBoardPosts('ALL', admin),
      ]);
      setPosts(nextPosts);
      setAllPosts(nextAllPosts);
      setSelectedPost((prev) => {
        if (clearSelection || !prev) return null;
        return nextAllPosts.find((post) => post.id === prev.id) ?? null;
      });
    } catch {
      setPosts([]);
      setAllPosts([]);
      setSelectedPost(null);
    } finally {
      setLoading(false);
    }
  }, [admin, filter]);

  const loadComments = useCallback(async (postId: number) => {
    setComments(await api.getBoardPostComments(postId));
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    if (!selectedPost) {
      setComments([]);
      setMemoDraft('');
      setCommentText('');
      setCommentAttachments([]);
      setReplyTo(null);
      return;
    }
    loadComments(selectedPost.id).catch(() => setComments([]));
    setMemoDraft(selectedPost.myMemo ?? '');
  }, [loadComments, selectedPost]);

  const counts = useMemo(() => {
    return allPosts.reduce(
      (acc, post) => {
        acc.total += 1;
        if (post.type === 'NOTICE') acc.notice += 1;
        if (post.visible) acc.visible += 1;
        if (post.pinned) acc.pinned += 1;
        return acc;
      },
      { total: 0, notice: 0, visible: 0, pinned: 0 }
    );
  }, [allPosts]);

  const visibleNotices = useMemo(() => allPosts.filter((post) => post.type === 'NOTICE' && post.visible), [allPosts]);

  const postRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const filteredPosts = query
      ? posts.filter((post) =>
          [post.title, post.content, post.createdBy, typeLabel[post.type]]
            .join(' ')
            .toLowerCase()
            .includes(query)
        )
      : posts;
    const postsByParent = new Map<number | null, BoardPost[]>();
    filteredPosts.forEach((post) => {
      const parentKey = filteredPosts.some((candidate) => candidate.id === post.parentId) ? post.parentId : null;
      postsByParent.set(parentKey, [...(postsByParent.get(parentKey) ?? []), post]);
    });
    const rows: Array<{ post: BoardPost; depth: number }> = [];
    const visit = (parentId: number | null, depth: number) => {
      (postsByParent.get(parentId) ?? []).forEach((post) => {
        rows.push({ post, depth });
        visit(post.id, depth + 1);
      });
    };
    visit(null, 0);
    return rows;
  }, [posts, searchTerm]);

  const selectedPostReplies = useMemo(() => {
    if (!selectedPost) return [];
    return allPosts.filter((post) => post.parentId === selectedPost.id);
  }, [allPosts, selectedPost]);

  const selectedPostParent = useMemo(() => {
    if (!selectedPost?.parentId) return null;
    return allPosts.find((post) => post.id === selectedPost.parentId) ?? null;
  }, [allPosts, selectedPost]);

  const topLevelComments = useMemo(() => comments.filter((comment) => !comment.parentId), [comments]);

  const repliesByParent = useMemo(() => {
    const result = new Map<number, BoardPostComment[]>();
    comments.forEach((comment) => {
      if (!comment.parentId) return;
      result.set(comment.parentId, [...(result.get(comment.parentId) ?? []), comment]);
    });
    return result;
  }, [comments]);

  const openCreateDialog = () => {
    setEditingPost(null);
    setReplyTargetPost(null);
    setForm(emptyForm(admin));
    setShowExposureSettings(false);
    setError('');
    setDialogOpen(true);
  };

  const openEditDialog = (post: BoardPost) => {
    setEditingPost(post);
    setReplyTargetPost(null);
    setForm({
      type: post.type,
      title: post.title,
      parentId: post.parentId,
      content: post.content,
      attachments: post.attachments ?? [],
      visible: post.visible,
      pinned: post.pinned,
      visibleFrom: post.visibleFrom,
      visibleUntil: post.visibleUntil,
    });
    setShowExposureSettings(false);
    setError('');
    setDialogOpen(true);
  };

  const openPostReplyDialog = (post: BoardPost) => {
    setEditingPost(null);
    setReplyTargetPost(post);
    setForm({
      ...emptyForm(admin),
      type: post.type === 'NOTICE' && !admin ? 'FREE' : post.type,
      title: post.title.startsWith('RE: ') ? post.title : `RE: ${post.title}`,
      parentId: post.id,
      attachments: [],
      pinned: false,
    });
    setShowExposureSettings(false);
    setError('');
    setDialogOpen(true);
  };

  const savePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const payload = admin
        ? form
        : { ...form, type: form.type === 'NOTICE' ? 'FREE' : form.type, visible: true, pinned: false, visibleFrom: null, visibleUntil: null };
      if (editingPost) {
        await api.updateBoardPost(editingPost.id, payload);
      } else {
        await api.createBoardPost(payload);
      }
      setDialogOpen(false);
      await loadPosts();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패');
    }
  };

  const deletePost = async (post: BoardPost) => {
    if (!confirm(`"${post.title}" 게시글을 삭제하시겠습니까?`)) return;
    await api.deleteBoardPost(post.id);
    if (selectedPost?.id === post.id) setSelectedPost(null);
    await loadPosts();
  };

  const updatePostFlags = async (post: BoardPost, patch: Partial<BoardPostFormData>) => {
    await api.updateBoardPost(post.id, {
      type: post.type,
      title: post.title,
      content: post.content,
      attachments: post.attachments ?? [],
      parentId: post.parentId,
      visible: post.visible,
      pinned: post.pinned,
      visibleFrom: post.visibleFrom,
      visibleUntil: post.visibleUntil,
      ...patch,
    });
    await loadPosts();
  };

  const updateReaction = async (post: BoardPost, patch: { liked?: boolean; rating?: number | null; memo?: string }) => {
    const next = await api.updateBoardPostReaction(post.id, {
      liked: patch.liked ?? post.myLiked,
      rating: patch.rating !== undefined ? patch.rating : post.myRating,
      memo: patch.memo !== undefined ? patch.memo : post.myMemo ?? '',
    });
    setPosts((prev) => prev.map((item) => (item.id === next.id ? next : item)));
    setAllPosts((prev) => prev.map((item) => (item.id === next.id ? next : item)));
    setSelectedPost((prev) => (prev?.id === next.id ? next : prev));
  };

  const saveComment = async () => {
    if (!selectedPost || !commentText.trim()) return;
    await api.createBoardPostComment(selectedPost.id, {
      parentId: replyTo?.id ?? null,
      content: commentText,
      attachments: commentAttachments,
    });
    setCommentText('');
    setCommentAttachments([]);
    setReplyTo(null);
    await loadComments(selectedPost.id);
    await loadPosts();
  };

  const deleteComment = async (comment: BoardPostComment) => {
    if (!selectedPost) return;
    await api.deleteBoardPostComment(comment.id);
    await loadComments(selectedPost.id);
    await loadPosts();
  };

  const canEditPost = (post: BoardPost) => admin || post.createdBy === username;
  const typeOptions: BoardPostType[] = admin ? ['NOTICE', 'REQUEST', 'QUESTION', 'FAQ', 'FREE', 'ETC'] : ['REQUEST', 'QUESTION', 'FAQ', 'FREE', 'ETC'];

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">공지사항 / 게시판</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            공지 노출 설정은 관리자만, 글과 댓글 반응은 로그인 사용자가 함께 사용합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => loadPosts(true)} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            새로고침
          </Button>
          <Button type="button" size="sm" onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            글 등록
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">목록/공지 현황</h3>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {[
            ['전체', counts.total],
            ['공지', counts.notice],
            ['노출', counts.visible],
            ['고정', counts.pinned],
            ['하단 공지', visibleNotices[0]?.title ?? '-'],
          ].map(([label, value]) => (
            <div key={label} className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="max-w-[360px] truncate font-semibold text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(['ALL', 'NOTICE', 'REQUEST', 'QUESTION', 'FAQ', 'FREE', 'ETC'] as BoardFilter[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs font-medium transition',
                filter === item
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent'
              )}
            >
              {item === 'ALL' ? '전체' : typeLabel[item]}
            </button>
          ))}
        </div>
        <label className="relative w-full @min-[40rem]:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="제목, 내용, 작성자 검색"
            className="pl-9"
          />
        </label>
      </div>

      <div className="grid gap-4 @7xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-[108px_minmax(260px,1fr)_160px_120px_160px_132px] border-b border-border bg-muted px-4 py-2 text-xs font-medium text-muted-foreground">
              <span>유형</span>
              <span>제목</span>
              <span>반응</span>
              <span>상태</span>
              <span>수정일</span>
              <span className="text-right">작업</span>
            </div>
            {postRows.length === 0 && (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                <MessageSquareText className="mx-auto mb-2 h-5 w-5" />
                게시글이 없습니다.
              </div>
            )}
            {postRows.map(({ post, depth }) => (
              <div
                key={post.id}
                className={cn(
                  'grid grid-cols-[108px_minmax(260px,1fr)_160px_120px_160px_132px] items-center border-b border-border px-4 py-3 text-sm last:border-b-0 hover:bg-primary/5',
                  selectedPost?.id === post.id && 'bg-primary/10',
                  post.pinned && 'bg-warning/5'
                )}
              >
                <div className="flex items-center gap-1">
                  {depth > 0 && <Reply className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className={cn('w-fit rounded-full px-2 py-0.5 text-xs font-medium', typeTone[post.type])}>
                    {depth > 0 ? '리플' : typeLabel[post.type]}
                  </span>
                </div>
                <button type="button" onClick={() => setSelectedPost(post)} className="min-w-0 text-left">
                  <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth ? Math.min(depth, 3) * 18 : 0 }}>
                    {post.pinned && <Bell className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                    <span className="truncate font-medium text-foreground">{post.title}</span>
                    {(post.attachments?.length ?? 0) > 0 && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground" style={{ paddingLeft: depth ? Math.min(depth, 3) * 18 : 0 }}>
                    {post.createdBy} · 리플 {post.replyCount} · 댓글 {post.commentCount}
                  </span>
                </button>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => updateReaction(post, { liked: !post.myLiked })}
                    className={cn('flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent', post.myLiked && 'text-destructive')}
                  >
                    <Heart className={cn('h-3.5 w-3.5', post.myLiked && 'fill-current')} />
                    {post.likeCount}
                  </button>
                  <span className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 text-amber-500" />
                    {post.ratingAverage ? post.ratingAverage.toFixed(1) : '-'} ({post.ratingCount})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className={cn('w-fit rounded-full px-2 py-0.5 text-xs font-medium', post.visible ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
                    {post.visible ? '노출' : '숨김'}
                  </span>
                  {post.visibleFrom || post.visibleUntil ? (
                    <span className="w-fit rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      기간
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">{formatDate(post.updatedAt)}</span>
                <div className="flex justify-end gap-1">
                  {admin && (
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => updatePostFlags(post, { visible: !post.visible })}
                      aria-label="노출 전환"
                    >
                      {post.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                  )}
                  {canEditPost(post) && (
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => openEditDialog(post)}
                      aria-label="수정"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => openPostReplyDialog(post)}
                    aria-label="글 리플"
                  >
                    <Reply className="h-4 w-4" />
                  </button>
                  {canEditPost(post) && (
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                      onClick={() => deletePost(post)}
                      aria-label="삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card">
          {!selectedPost ? (
            <div className="px-4 py-16 text-center text-sm text-muted-foreground">
              <MessageSquareText className="mx-auto mb-2 h-5 w-5" />
              게시글을 선택하면 댓글과 메모를 볼 수 있습니다.
            </div>
          ) : (
            <div className="divide-y divide-border">
              <div className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', typeTone[selectedPost.type])}>
                      {typeLabel[selectedPost.type]}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{formatDate(selectedPost.createdAt)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPost(null)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="상세 닫기"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <h3 className="text-base font-semibold text-foreground">{selectedPost.title}</h3>
                {selectedPostParent && (
                  <button
                    type="button"
                    onClick={() => setSelectedPost(selectedPostParent)}
                    className="mt-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                  >
                    원글: {selectedPostParent.title}
                  </button>
                )}
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{selectedPost.content}</p>
                <AttachmentList attachments={selectedPost.attachments ?? []} />
                {admin && (selectedPost.visibleFrom || selectedPost.visibleUntil) && (
                  <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {formatDate(selectedPost.visibleFrom)} ~ {formatDate(selectedPost.visibleUntil)}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => openPostReplyDialog(selectedPost)}>
                    <Reply className="h-4 w-4" />
                    글 리플 작성
                  </Button>
                </div>
                {selectedPostReplies.length > 0 && (
                  <div className="mt-4 rounded-md border border-border bg-muted px-3 py-2">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">글 리플 {selectedPostReplies.length}</p>
                    <div className="space-y-1">
                      {selectedPostReplies.map((reply) => (
                        <button
                          key={reply.id}
                          type="button"
                          onClick={() => setSelectedPost(reply)}
                          className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-foreground hover:bg-card"
                        >
                          {reply.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-foreground">내 반응</span>
                  <button
                    type="button"
                    onClick={() => updateReaction(selectedPost, { liked: !selectedPost.myLiked })}
                    className={cn('flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-accent', selectedPost.myLiked && 'text-destructive')}
                  >
                    <Heart className={cn('h-4 w-4', selectedPost.myLiked && 'fill-current')} />
                    좋아요 {selectedPost.likeCount}
                  </button>
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      type="button"
                      onClick={() => updateReaction(selectedPost, { rating: selectedPost.myRating === rating ? null : rating })}
                      className="rounded-md p-1 text-amber-500 hover:bg-warning/10"
                      aria-label={`${rating}점`}
                    >
                      <Star className={cn('h-5 w-5', selectedPost.myRating && selectedPost.myRating >= rating && 'fill-current')} />
                    </button>
                  ))}
                </div>
                <textarea
                  value={memoDraft}
                  onChange={(e) => setMemoDraft(e.target.value)}
                  rows={3}
                  placeholder="내 메모"
                  className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => updateReaction(selectedPost, { memo: memoDraft })}
                >
                  메모 저장
                </Button>
              </div>

              <div className="space-y-3 p-4">
                <h3 className="text-sm font-semibold text-foreground">댓글 {comments.length}</h3>
                <div className="space-y-3">
                  {topLevelComments.map((comment) => (
                    <div key={comment.id} className="space-y-2 rounded-md border border-border px-3 py-2">
                      <CommentRow
                        comment={comment}
                        username={username}
                        admin={admin}
                        onReply={() => setReplyTo(comment)}
                        onDelete={() => deleteComment(comment)}
                      />
                      <AttachmentList attachments={comment.attachments ?? []} compact />
                      {(repliesByParent.get(comment.id) ?? []).map((reply) => (
                        <div key={reply.id} className="ml-5 border-l border-border pl-3">
                          <CommentRow
                            comment={reply}
                            username={username}
                            admin={admin}
                            onReply={() => setReplyTo(reply)}
                            onDelete={() => deleteComment(reply)}
                          />
                          <AttachmentList attachments={reply.attachments ?? []} compact />
                        </div>
                      ))}
                    </div>
                  ))}
                  {comments.length === 0 && <p className="text-sm text-muted-foreground">아직 댓글이 없습니다.</p>}
                </div>
                {replyTo && (
                  <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
                    <span>{replyTo.createdBy}에게 답글 작성 중</span>
                    <button type="button" onClick={() => setReplyTo(null)}>취소</button>
                  </div>
                )}
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={3}
                  placeholder="댓글 입력"
                  className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <AttachmentInput
                    attachments={commentAttachments}
                    onChange={setCommentAttachments}
                    label="댓글 첨부"
                  />
                  <Button type="button" size="sm" onClick={saveComment} disabled={!commentText.trim()}>
                    댓글 저장
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPost ? '게시글 수정' : replyTargetPost ? '글 리플 등록' : '게시글 등록'}</DialogTitle>
            <DialogDescription>
              {replyTargetPost
                ? `"${replyTargetPost.title}"에 대한 리플 글입니다.`
                : admin ? '노출 설정은 필요할 때만 펼쳐 조정합니다.' : '공지와 노출 설정은 관리자만 사용할 수 있습니다.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={savePost} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <label className="space-y-1 text-xs text-muted-foreground">
                유형
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as BoardPostType })}
                  className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground"
                >
                  {typeOptions.map((type) => (
                    <option key={type} value={type}>{typeLabel[type]}</option>
                  ))}
                </select>
              </label>
              {admin && (
                <button
                  type="button"
                  onClick={() => setShowExposureSettings((prev) => !prev)}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                    노출 설정
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {form.visible ? '노출' : '숨김'} · {form.pinned ? '고정' : '일반'}
                  </span>
                </button>
              )}
            </div>

            {replyTargetPost && (
              <div className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
                원글: {replyTargetPost.title}
              </div>
            )}

            {admin && showExposureSettings && (
              <div className="rounded-md border border-border bg-muted p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
                    <span>
                      <span className="block font-medium text-foreground">노출</span>
                      <span className="block text-xs text-muted-foreground">목록/공지 영역 표시</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={form.visible}
                      onChange={(e) => setForm({ ...form, visible: e.target.checked })}
                      className="h-4 w-4 rounded border-border"
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
                    <span>
                      <span className="block font-medium text-foreground">고정</span>
                      <span className="block text-xs text-muted-foreground">상단 우선 정렬</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={form.pinned}
                      onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                      className="h-4 w-4 rounded border-border"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    노출 시작
                    <input
                      type="datetime-local"
                      value={toDateTimeLocal(form.visibleFrom)}
                      onChange={(e) => setForm({ ...form, visibleFrom: fromDateTimeLocal(e.target.value) })}
                      className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    노출 종료
                    <input
                      type="datetime-local"
                      value={toDateTimeLocal(form.visibleUntil)}
                      onChange={(e) => setForm({ ...form, visibleUntil: fromDateTimeLocal(e.target.value) })}
                      className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground"
                    />
                  </label>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>제목</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                maxLength={200}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>내용</Label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                required
                rows={8}
                className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>

            <AttachmentInput
              attachments={form.attachments}
              onChange={(attachments) => setForm({ ...form, attachments })}
              label="첨부파일"
            />

            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                취소
              </Button>
              <Button type="submit">저장</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CommentRow({
  comment,
  username,
  admin,
  onReply,
  onDelete,
}: {
  comment: BoardPostComment;
  username: string;
  admin: boolean;
  onReply: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="text-sm">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{comment.createdBy}</span>
        <span className="text-[11px] text-muted-foreground">{formatDate(comment.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-foreground">{comment.content}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={onReply} className="flex items-center gap-1 text-xs text-primary hover:opacity-80">
          <Reply className="h-3.5 w-3.5" />
          답글
        </button>
        {(admin || comment.createdBy === username) && (
          <button type="button" onClick={onDelete} className="text-xs text-destructive hover:text-destructive/80">
            삭제
          </button>
        )}
      </div>
    </div>
  );
}

function AttachmentInput({
  attachments,
  onChange,
  label,
}: {
  attachments: BoardAttachment[];
  onChange: (attachments: BoardAttachment[]) => void;
  label: string;
}) {
  const [fileError, setFileError] = useState('');

  const addFiles = async (files: FileList | null) => {
    setFileError('');
    try {
      const next = await filesToAttachments(files);
      onChange([...attachments, ...next].slice(0, 5));
    } catch (err) {
      setFileError(err instanceof Error ? err.message : '첨부파일 추가 실패');
    }
  };

  return (
    <div className="space-y-2">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-accent">
        <Paperclip className="h-4 w-4 text-muted-foreground" />
        {label}
        <input
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => {
            addFiles(e.target.files);
            e.currentTarget.value = '';
          }}
        />
      </label>
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment, index) => (
            <span
              key={`${attachment.name}-${index}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-foreground"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[220px] truncate">{attachment.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.size)}</span>
              <button
                type="button"
                onClick={() => onChange(attachments.filter((_, itemIndex) => itemIndex !== index))}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="첨부 삭제"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      {fileError && <p className="text-xs text-destructive">{fileError}</p>}
      <p className="text-xs text-muted-foreground">최대 5개, 파일당 5MiB</p>
    </div>
  );
}

function AttachmentList({
  attachments,
  compact = false,
}: {
  attachments: BoardAttachment[];
  compact?: boolean;
}) {
  if (!attachments.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-2', compact ? 'mt-2' : 'mt-3')}>
      {attachments.map((attachment, index) => (
        <a
          key={`${attachment.name}-${index}`}
          href={attachment.dataUrl}
          download={attachment.name}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
          title={attachment.name}
        >
          <Paperclip className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[240px] truncate">{attachment.name}</span>
          <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.size)}</span>
        </a>
      ))}
    </div>
  );
}
