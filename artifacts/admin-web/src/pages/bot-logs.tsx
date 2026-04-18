import { useListBotLogs } from "@workspace/api-client-react";
import { useState } from "react";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

export default function BotLogs() {
  const [page, setPage] = useState(1);
  const [level, setLevel] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  
  const { data: logs, isLoading } = useListBotLogs({
    page,
    limit: 20,
    level: level !== "all" ? level : undefined,
    action: action !== "all" ? action : undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nhật ký Bot</h1>
          <p className="text-muted-foreground mt-1">Lịch sử hoạt động và lỗi của Telegram Bot.</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Cấp độ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả cấp độ</SelectItem>
            <SelectItem value="info">Thông tin (Info)</SelectItem>
            <SelectItem value="warn">Cảnh báo (Warn)</SelectItem>
            <SelectItem value="error">Lỗi (Error)</SelectItem>
          </SelectContent>
        </Select>
        
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Loại hành động" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả hành động</SelectItem>
            <SelectItem value="start">/start</SelectItem>
            <SelectItem value="order_create">Tạo đơn hàng</SelectItem>
            <SelectItem value="payment_verify">Xác nhận thanh toán</SelectItem>
            <SelectItem value="webhook_error">Lỗi Webhook</SelectItem>
          </SelectContent>
        </Select>
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
                  <TableHead className="w-[100px]">Cấp độ</TableHead>
                  <TableHead className="w-[150px]">Hành động</TableHead>
                  <TableHead className="w-[100px]">Chat ID</TableHead>
                  <TableHead>Nội dung</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs?.data?.map((log) => (
                  <TableRow key={log.id}>
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
                    <TableCell className="text-sm font-mono">{log.content}</TableCell>
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
        >
          Trang trước
        </Button>
        <span className="text-sm text-muted-foreground">Trang {page}</span>
        <Button 
          variant="outline" 
          onClick={() => setPage(p => p + 1)}
          disabled={!logs || logs.data.length < 20}
        >
          Trang sau
        </Button>
      </div>
    </div>
  );
}
