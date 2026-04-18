import { useListProductStocks, useAddProductStocks, useDeleteStock, getListProductStocksQueryKey, useGetProduct } from "@workspace/api-client-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, ArrowLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Link } from "wouter";
import { formatDate } from "@/lib/utils";

export default function ProductStocks({ params }: { params: { id: string } }) {
  const productId = parseInt(params.id);
  const [status, setStatus] = useState<string>("all");
  
  const { data: product } = useGetProduct(productId, {
    query: { enabled: !!productId }
  });

  const { data: stockList, isLoading } = useListProductStocks(productId, {
    status: status !== "all" ? status : undefined,
  }, {
    query: { enabled: !!productId }
  });

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [stockLines, setStockLines] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const addStocks = useAddProductStocks();
  const deleteStock = useDeleteStock();

  const handleAddStocks = () => {
    if (!stockLines.trim()) return;
    const lines = stockLines.split("\n").filter(line => line.trim().length > 0);
    
    addStocks.mutate(
      { productId, data: { lines } },
      {
        onSuccess: (res) => {
          toast({ title: `Đã thêm ${res.added} kho số mới` });
          setIsAddOpen(false);
          setStockLines("");
          queryClient.invalidateQueries({ queryKey: getListProductStocksQueryKey(productId) });
        },
      }
    );
  };

  const handleDelete = (stockId: number) => {
    if (!confirm("Bạn có chắc chắn muốn xóa kho số này?")) return;
    deleteStock.mutate(
      { productId, id: stockId },
      {
        onSuccess: () => {
          toast({ title: "Đã xóa kho số" });
          queryClient.invalidateQueries({ queryKey: getListProductStocksQueryKey(productId) });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/products">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Quản lý Kho Số</h1>
          <p className="text-muted-foreground mt-1">Sản phẩm: <span className="text-primary font-medium">{product?.name || "..."}</span></p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Tất cả trạng thái" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả trạng thái</SelectItem>
              <SelectItem value="available">Sẵn sàng</SelectItem>
              <SelectItem value="sold">Đã bán</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="btn-add-stocks">
              <Plus className="h-4 w-4 mr-2" /> Nhập kho hàng loạt
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nhập kho số</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">Nhập mỗi tài khoản/key trên một dòng mới.</p>
                <Textarea 
                  rows={10} 
                  placeholder="user1:pass1&#10;user2:pass2&#10;key123"
                  value={stockLines}
                  onChange={(e) => setStockLines(e.target.value)}
                  className="font-mono text-sm"
                  data-testid="textarea-stock-lines"
                />
              </div>
              <Button 
                onClick={handleAddStocks} 
                className="w-full" 
                disabled={addStocks.isPending || !stockLines.trim()}
              >
                {addStocks.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Xác nhận nhập kho
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
                  <TableHead>ID</TableHead>
                  <TableHead>Nội dung kho</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Ngày tạo</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockList?.data?.map((stock) => (
                  <TableRow key={stock.id} data-testid={`row-stock-${stock.id}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{stock.id}</TableCell>
                    <TableCell className="font-mono text-sm max-w-[300px] truncate" title={stock.content}>
                      {stock.content}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        stock.status === 'available' ? "bg-emerald-500/10 text-emerald-500" : 
                        stock.status === 'sold' ? "bg-primary/10 text-primary" : 
                        "bg-muted text-muted-foreground"
                      }`}>
                        {stock.status === 'available' ? "Sẵn sàng" : "Đã bán"}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(stock.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {stock.status === 'available' && (
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(stock.id)} data-testid={`btn-delete-stock-${stock.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {stockList?.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      Không tìm thấy kho số nào.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
