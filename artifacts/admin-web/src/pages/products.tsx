import { useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct, getListProductsQueryKey, useListCategories, useListProductStockRequests, Product } from "@workspace/api-client-react";
import { useState } from "react";
import { formatVND } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Pencil, Trash2, Box, Users, ArrowDown, ArrowUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useSearch, useLocation } from "wouter";

const productSchema = z.object({
  name: z.string().min(1, "Tên sản phẩm là bắt buộc"),
  description: z.string().optional(),
  price: z.string().min(1, "Giá là bắt buộc"),
  usdtPrice: z.string().optional(),
  categoryId: z.coerce.number().optional(),
  isActive: z.boolean().default(true),
  minQuantity: z.coerce.number().default(1),
  maxQuantity: z.coerce.number().default(999),
  productType: z.string().default("digital"),
  productIcon: z.string().optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

function StockRequestersDialog({ productId, productName, onClose }: { productId: number; productName: string; onClose: () => void }) {
  const { data, isLoading } = useListProductStockRequests(productId);

  return (
    <DialogContent className="sm:max-w-[500px] max-h-[70vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          Khách hàng yêu cầu hàng mới
        </DialogTitle>
        <p className="text-sm text-muted-foreground mt-1">{productName}</p>
      </DialogHeader>
      {isLoading ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.data?.length ? (
        <p className="text-sm text-muted-foreground text-center py-6">Chưa có yêu cầu hàng mới nào.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{data.total} khách hàng đã yêu cầu</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Khách hàng</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Chat ID</TableHead>
                <TableHead>Thời gian</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((requester, idx) => (
                <TableRow key={requester.customerId ?? idx}>
                  <TableCell className="font-medium">
                    {[requester.firstName, requester.lastName].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {requester.username ? `@${requester.username}` : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{requester.chatId ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {requester.requestedAt ? new Date(requester.requestedAt).toLocaleString("vi-VN") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </DialogContent>
  );
}

export default function Products() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [isActiveFilter, setIsActiveFilter] = useState<string>("all");
  const [stockRequestProduct, setStockRequestProduct] = useState<{ id: number; name: string } | null>(null);

  const searchString = useSearch();
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(searchString);
  const rawOrderBy = searchParams.get("orderBy");
  const orderBy: "createdAt" | "stockRequestCount" =
    rawOrderBy === "stockRequestCount" ? "stockRequestCount" : "createdAt";

  const setOrderBy = (value: "createdAt" | "stockRequestCount") => {
    const params = new URLSearchParams(searchString);
    if (value === "createdAt") {
      params.delete("orderBy");
    } else {
      params.set("orderBy", value);
    }
    const qs = params.toString();
    setLocation(qs ? `${location}?${qs}` : location, { replace: true });
    setPage(1);
  };
  
  const { data: productList, isLoading } = useListProducts({
    page,
    limit: 10,
    search: search || undefined,
    categoryId: categoryId !== "all" ? Number(categoryId) : undefined,
    isActive: isActiveFilter !== "all" ? isActiveFilter === "true" : undefined,
    orderBy,
  });

  const { data: categoryList } = useListCategories();
  const categoryMap = new Map(
    (categoryList?.data ?? []).map((c) => [c.id, { name: c.name, icon: c.icon ?? null }])
  );

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      description: "",
      price: "",
      usdtPrice: "",
      isActive: true,
      minQuantity: 1,
      maxQuantity: 999,
      productType: "digital",
      productIcon: "",
    },
  });

  const onSubmit = (data: ProductFormValues) => {
    const trimmedIcon = data.productIcon?.trim();
    const trimmedUsdtPrice = data.usdtPrice?.trim();
    const normalizedData = {
      ...data,
      productIcon: editingId != null ? trimmedIcon : (trimmedIcon || undefined),
      usdtPrice: trimmedUsdtPrice || null,
    };
    if (editingId) {
      updateProduct.mutate(
        { id: editingId, data: normalizedData },
        {
          onSuccess: () => {
            toast({ title: "Đã cập nhật sản phẩm" });
            setIsAddOpen(false);
            setEditingId(null);
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          },
        }
      );
    } else {
      createProduct.mutate(
        { data: normalizedData },
        {
          onSuccess: () => {
            toast({ title: "Đã tạo sản phẩm" });
            setIsAddOpen(false);
            form.reset();
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          },
        }
      );
    }
  };

  const handleEdit = (product: Product) => {
    setEditingId(product.id);
    form.reset({
      name: product.name,
      description: product.description || "",
      price: product.price.toString(),
      usdtPrice: product.usdtPrice || "",
      categoryId: product.categoryId || undefined,
      isActive: product.isActive,
      minQuantity: product.minQuantity,
      maxQuantity: product.maxQuantity,
      productType: product.productType,
      productIcon: product.productIcon || "",
    });
    setIsAddOpen(true);
  };

  const handleDelete = (id: number) => {
    if (!confirm("Bạn có chắc chắn muốn xóa sản phẩm này?")) return;
    deleteProduct.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Đã xóa sản phẩm" });
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sản phẩm</h1>
          <p className="text-muted-foreground mt-1">Quản lý kho số và giá bán.</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingId(null); form.reset(); }} data-testid="btn-add-product">
              <Plus className="h-4 w-4 mr-2" /> Thêm sản phẩm
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Cập nhật sản phẩm" : "Thêm sản phẩm mới"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Tên sản phẩm</FormLabel>
                        <FormControl>
                          <Input placeholder="VD: Netflix 1 tháng" {...field} data-testid="input-product-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="productIcon"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Icon sản phẩm (emoji)</FormLabel>
                        <FormControl>
                          <Input placeholder="VD: 📦" {...field} data-testid="input-product-icon" />
                        </FormControl>
                        <FormDescription className="text-xs">Nhập một emoji đại diện cho sản phẩm. Mặc định: 📦</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Giá bán (VNĐ)</FormLabel>
                        <FormControl>
                          <Input placeholder="VD: 50000" {...field} data-testid="input-product-price" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="usdtPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Giá USDT (Binance Pay)</FormLabel>
                        <FormControl>
                          <Input placeholder="VD: 2.50" {...field} data-testid="input-product-usdt-price" />
                        </FormControl>
                        <FormDescription className="text-xs">Để trống nếu không hỗ trợ thanh toán USDT.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Danh mục</FormLabel>
                        <Select onValueChange={(val) => field.onChange(val ? Number(val) : undefined)} value={field.value?.toString() || ""}>
                          <FormControl>
                            <SelectTrigger data-testid="select-product-category">
                              <SelectValue placeholder="Chọn danh mục" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {categoryList?.data?.map((cat) => (
                              <SelectItem key={cat.id} value={cat.id.toString()}>
                                {cat.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Mô tả (Hỗ trợ Markdown)</FormLabel>
                        <FormControl>
                          <Input placeholder="Mô tả sản phẩm" {...field} data-testid="input-product-description" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="minQuantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Số lượng tối thiểu/đơn</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} data-testid="input-product-min-qty" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="maxQuantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Số lượng tối đa/đơn</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} data-testid="input-product-max-qty" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                      <div>
                        <FormLabel className="text-sm font-medium">Đang bán</FormLabel>
                        <FormDescription className="text-xs">Hiển thị sản phẩm cho khách hàng</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-product-active" />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full mt-4" disabled={createProduct.isPending || updateProduct.isPending}>
                  {createProduct.isPending || updateProduct.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Lưu sản phẩm
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4">
        <Input 
          placeholder="Tìm kiếm sản phẩm..." 
          className="max-w-xs" 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-search-products"
        />
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Tất cả danh mục" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả danh mục</SelectItem>
            {categoryList?.data?.map((cat) => (
              <SelectItem key={cat.id} value={cat.id.toString()}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={isActiveFilter} onValueChange={(v) => { setIsActiveFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px]" data-testid="select-product-status">
            <SelectValue placeholder="Trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
            <SelectItem value="true">Đang bán</SelectItem>
            <SelectItem value="false">Đã ẩn</SelectItem>
          </SelectContent>
        </Select>
        <Select value={orderBy} onValueChange={(v) => setOrderBy(v as "createdAt" | "stockRequestCount")}>
          <SelectTrigger className="w-[200px]" data-testid="select-product-order">
            <SelectValue placeholder="Sắp xếp" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="createdAt">Mới nhất</SelectItem>
            <SelectItem value="stockRequestCount">Yêu cầu nhiều nhất</SelectItem>
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
                  <TableHead>ID</TableHead>
                  <TableHead>Icon</TableHead>
                  <TableHead>Tên sản phẩm</TableHead>
                  <TableHead>Danh mục</TableHead>
                  <TableHead>Giá bán</TableHead>
                  <TableHead>Giá USDT</TableHead>
                  <TableHead>Tồn kho</TableHead>
                  <TableHead
                    className="whitespace-nowrap cursor-pointer select-none hover:bg-muted/50 transition-colors"
                    onClick={() => setOrderBy(orderBy === "stockRequestCount" ? "createdAt" : "stockRequestCount")}
                    data-testid="th-sort-stock-request"
                  >
                    <span className="inline-flex items-center gap-1">
                      Yêu cầu hàng mới
                      {orderBy === "stockRequestCount" ? (
                        <ArrowDown className="h-3.5 w-3.5 text-primary" data-testid="sort-icon-stock-request" />
                      ) : (
                        <ArrowUp className="h-3.5 w-3.5 text-muted-foreground/50" data-testid="sort-icon-created-at" />
                      )}
                    </span>
                  </TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productList?.data?.map((product) => (
                  <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                    <TableCell className="font-mono text-xs">{product.id}</TableCell>
                    <TableCell className="text-xl" data-testid={`icon-product-${product.id}`}>{product.productIcon || "📦"}</TableCell>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell data-testid={`category-product-${product.id}`}>
                      {product.categoryId != null ? (
                        <span className="inline-flex items-center gap-1">
                          <span>{categoryMap.get(product.categoryId)?.icon ?? "📁"}</span>
                          <span className="text-sm">{categoryMap.get(product.categoryId)?.name ?? `#${product.categoryId}`}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>{formatVND(product.price)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {product.usdtPrice ? (
                        <span className="text-amber-500">${parseFloat(product.usdtPrice).toFixed(2)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`font-mono font-bold ${product.stockCount < 10 ? "text-destructive" : "text-emerald-500"}`}>
                        {product.stockCount}
                      </span>
                    </TableCell>
                    <TableCell>
                      {product.stockRequestCount > 0 ? (
                        <button
                          onClick={() => setStockRequestProduct({ id: product.id, name: product.name })}
                          data-testid={`btn-stock-requests-${product.id}`}
                          className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 hover:bg-amber-500/20 transition-colors cursor-pointer"
                        >
                          <Users className="h-3 w-3" />
                          {product.stockRequestCount}
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${product.isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"}`}>
                        {product.isActive ? "Đang bán" : "Đã ẩn"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/products/${product.id}/stocks`}>
                          <Button variant="ghost" size="icon" title="Quản lý kho" data-testid={`btn-stocks-product-${product.id}`}>
                            <Box className="h-4 w-4 text-primary" />
                          </Button>
                        </Link>
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(product)} data-testid={`btn-edit-product-${product.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(product.id)} data-testid={`btn-delete-product-${product.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {productList?.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                      Không tìm thấy sản phẩm nào.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!stockRequestProduct} onOpenChange={(open) => { if (!open) setStockRequestProduct(null); }}>
        {stockRequestProduct && (
          <StockRequestersDialog
            productId={stockRequestProduct.id}
            productName={stockRequestProduct.name}
            onClose={() => setStockRequestProduct(null)}
          />
        )}
      </Dialog>

      <div className="flex justify-between items-center mt-4">
        <Button
          variant="outline"
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page === 1}
          data-testid="btn-prev-page"
        >
          Trang trước
        </Button>
        <span className="text-sm text-muted-foreground">Trang {page} {productList?.total ? `• ${productList.total} sản phẩm` : ""}</span>
        <Button
          variant="outline"
          onClick={() => setPage(p => p + 1)}
          disabled={!productList || productList.data.length < 10}
          data-testid="btn-next-page"
        >
          Trang sau
        </Button>
      </div>
    </div>
  );
}
