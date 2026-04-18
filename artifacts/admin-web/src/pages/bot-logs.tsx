import { useListBotLogs, getListBotLogsQueryKey } from "@workspace/api-client-react";
import { useState, useEffect, useCallback } from "react";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Play, Pause } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function BotLogs() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const queryClient = useQueryClient();

  const queryParams = {
    page,
    limit: 20,
    level: level !== "all" ? level : undefined,
    action: action !== "all" ? action : undefined,
    search: search || undefined,
  };

  const { data: logs, isLoading, isFetching } = useListBotLogs(queryParams);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListBotLogsQueryKey(queryParams) });
  }, [queryClient, page, level, action, search]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(handleRefresh, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, handleRefresh]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nhật ký Bot</h1>
          <p className="text-muted-foreground mt-1">Lịch sử hoạt động và lỗi của Telegram Bot.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            data-testid="btn-refresh-logs"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Làm mới
          </Button>
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(v => !v)}
            data-testid="btn-auto-refresh"
          >
            {autoRefresh ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
            {autoRefresh ? "Dừng tự động" : "Tự động làm mới"}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <Input
          placeholder="Tìm theo nội dung, chat ID..."
          className="max-w-xs"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          data-testid="input-search-logs"
        />
        <Select value={level} onValueChange={(v) => { setLevel(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Cấp độ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả cấp độ</SelectItem>
            <SelectItem value="info">Thông tin (Info)</SelectItem>
            <SelectItem value="warn">Cảnh báo (Warn)</SelectItem>
            <SelectItem value="error">Lỗi (Error)</SelectItem>
          </SelectContent>
        </Select>

        <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Loại hành động" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả hành động</SelectItem>
            <SelectItem value="start">/start</SelectItem>
            <SelectItem value="message">Tin nhắn</SelectItem>
            <SelectItem value="callback">Callback</SelectItem>
            <SelectItem value="browse_category">Xem danh mục</SelectItem>
            <SelectItem value="view_product">Xem sản phẩm</SelectItem>
            <SelectItem value="create_order">Tạo đơn hàng</SelectItem>
            <SelectItem value="payment_initiated">Khởi tạo thanh toán</SelectItem>
            <SelectItem value="delivery_sent">Giao hàng</SelectItem>
            <SelectItem value="delivery_failed">Lỗi giao hàng</SelectItem>
            <SelectItem value="bot_error">Lỗi Bot</SelectItem>
          </SelectContent>
        </Select>

        {autoRefresh && (
          <span className="text-xs text-primary animate-pulse">Tự động làm mới mỗi 5 giây</span>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">Thời gian</TableHead>
                  <TableHead className="w-[90px]">Cấp độ</TableHead>
                  <TableHead className="w-[160px]">Hành động</TableHead>
                  <TableHead className="w-[100px]">Chat ID</TableHead>
                  <TableHead>Nội dung</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs?.data?.map((log) => (
                  <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(log.createdAt)}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold ${
                        log.level === 'error' ? "bg-destructive/20 text-destructive" :
                        log.level === 'warn' ? "bg-yellow-500/20 text-yellow-500" :
                        "bg-primary/20 text-primary"
                      }`}>
                        {log.level.toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.action}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{log.chatId || '-'}</TableCell>
                    <TableCell className="text-sm font-mono max-w-[300px] truncate" title={log.content ?? undefined}>{log.content}</TableCell>
                  </TableRow>
                ))}
                {logs?.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      Không có nhật ký nào.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between items-center mt-4">
        <Button
          variant="outline"
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page === 1}
          data-testid="btn-prev-page"
        >
          Trang trước
        </Button>
        <span className="text-sm text-muted-foreground">Trang {page}</span>
        <Button
          variant="outline"
          onClick={() => setPage(p => p + 1)}
          disabled={!logs || logs.data.length < 20}
          data-testid="btn-next-page"
        >
          Trang sau
        </Button>
      </div>
    </div>
  );
}
