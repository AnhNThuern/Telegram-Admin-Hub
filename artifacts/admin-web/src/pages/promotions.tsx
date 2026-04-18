import { useListPromotions, useCreatePromotion, useUpdatePromotion, useDeletePromotion, getListPromotionsQueryKey, Promotion } from "@workspace/api-client-react";
import { useState } from "react";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Pencil, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Textarea } from "@/components/ui/textarea";

const PROMOTION_TYPES = [
  { value: "percentage", label: "Giảm theo % (percentage)" },
  { value: "fixed", label: "Giảm số tiền cố định (fixed)" },
  { value: "buy_x_get_y", label: "Mua X tặng Y (buy-X-get-Y)" },
  { value: "percent_by_qty", label: "Giảm % theo số lượng (percent-by-qty)" },
  { value: "topup", label: "Nạp tiền ưu đãi (topup)" },
  { value: "tiered", label: "Theo bậc (tiered)" },
];

const getTiersPlaceholder = (type: string) => {
  switch (type) {
    case "buy_x_get_y": return '{"buy": 2, "get": 1}';
    case "percent_by_qty": return '{"1": 0, "3": 10, "5": 20}';
    case "topup": return '{"10000": 11000, "50000": 57000, "100000": 120000}';
    case "tiered": return '{"100000": 5, "500000": 10, "1000000": 15}';
    default: return '{}';
  }
};

const promotionSchema = z.object({
  name: z.string().min(1, "Tên khuyến mãi là bắt buộc"),
  description: z.string().optional(),
  type: z.string().default("percentage"),
  appliesTo: z.string().default("all"),
  customerTarget: z.string().default("all"),
  priority: z.string().default("0"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  tiersJson: z.string().optional(),
  isActive: z.boolean().default(true),
});

type PromotionFormValues = z.infer<typeof promotionSchema>;

const TIERS_REQUIRED_TYPES = ["buy_x_get_y", "percent_by_qty", "topup", "tiered"];

export default function Promotions() {
  const { data: promotionList, isLoading } = useListPromotions();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showTiers, setShowTiers] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createPromotion = useCreatePromotion();
  const updatePromotion = useUpdatePromotion();
  const deletePromotion = useDeletePromotion();

  const form = useForm<PromotionFormValues>({
    resolver: zodResolver(promotionSchema),
    defaultValues: {
      name: "",
      description: "",
      type: "percentage",
      appliesTo: "all",
      customerTarget: "all",
      priority: "0",
      startDate: "",
      endDate: "",
      tiersJson: "",
      isActive: true,
    },
  });

  const watchedType = form.watch("type");
  const needsTiers = TIERS_REQUIRED_TYPES.includes(watchedType);

  const parseTiers = (json: string | undefined): Record<string, unknown> | undefined => {
    if (!json || !json.trim()) return undefined;
    try { return JSON.parse(json); } catch { return undefined; }
  };

  const onSubmit = (data: PromotionFormValues) => {
    const tiers = parseTiers(data.tiersJson);
    if (needsTiers && !tiers) {
      toast({ variant: "destructive", title: "Lỗi", description: "JSON cấu hình bậc không hợp lệ" });
      return;
    }
    const payload = {
      name: data.name,
      description: data.description || undefined,
      type: data.type,
      appliesTo: data.appliesTo,
      customerTarget: data.customerTarget,
      priority: parseInt(data.priority) || 0,
      startDate: data.startDate || undefined,
      endDate: data.endDate || undefined,
      isActive: data.isActive,
      tiers: tiers,
    };
    if (editingId) {
      updatePromotion.mutate(
        { id: editingId, data: payload },
        {
          onSuccess: () => {
            toast({ title: "Đã cập nhật khuyến mãi" });
            setIsAddOpen(false);
            setEditingId(null);
            queryClient.invalidateQueries({ queryKey: getListPromotionsQueryKey() });
          },
        }
      );
    } else {
      createPromotion.mutate(
        { data: payload },
        {
          onSuccess: () => {
            toast({ title: "Đã tạo khuyến mãi" });
            setIsAddOpen(false);
            form.reset();
            queryClient.invalidateQueries({ queryKey: getListPromotionsQueryKey() });
          },
        }
      );
    }
  };

  const handleEdit = (promo: Promotion) => {
    setEditingId(promo.id);
    const tiersStr = promo.tiers ? JSON.stringify(promo.tiers, null, 2) : "";
    form.reset({
      name: promo.name,
      description: promo.description || "",
      type: promo.type,
      appliesTo: promo.appliesTo,
      customerTarget: promo.customerTarget,
      priority: String(promo.priority ?? 0),
      startDate: promo.startDate ?? "",
      endDate: promo.endDate ?? "",
      tiersJson: tiersStr,
      isActive: promo.isActive,
    });
    setShowTiers(!!tiersStr);
    setIsAddOpen(true);
  };

  const handleDelete = (id: number) => {
    if (!confirm("Bạn có chắc chắn muốn xóa khuyến mãi này?")) return;
    deletePromotion.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Đã xóa khuyến mãi" });
          queryClient.invalidateQueries({ queryKey: getListPromotionsQueryKey() });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Khuyến mãi</h1>
          <p className="text-muted-foreground mt-1">Quản lý chương trình khuyến mãi và giảm giá.</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingId(null); form.reset(); setShowTiers(false); }} data-testid="btn-add-promotion">
              <Plus className="h-4 w-4 mr-2" /> Thêm khuyến mãi
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Cập nhật khuyến mãi" : "Thêm khuyến mãi mới"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tên khuyến mãi *</FormLabel>
                      <FormControl>
                        <Input placeholder="VD: Mua 2 tặng 1 tháng 5" {...field} data-testid="input-promo-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mô tả</FormLabel>
                      <FormControl>
                        <Input placeholder="Mô tả ngắn..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Loại khuyến mãi *</FormLabel>
                      <Select onValueChange={(v) => { field.onChange(v); if (TIERS_REQUIRED_TYPES.includes(v)) setShowTiers(true); }} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-promo-type">
                            <SelectValue placeholder="Chọn loại" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {PROMOTION_TYPES.map(t => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {(needsTiers || showTiers) && (
                  <FormField
                    control={form.control}
                    name="tiersJson"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          Cấu hình bậc (JSON) {needsTiers && <span className="text-destructive">*</span>}
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={getTiersPlaceholder(watchedType)}
                            className="font-mono text-xs h-24 resize-none"
                            {...field}
                            data-testid="input-promo-tiers"
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          {watchedType === "buy_x_get_y" && 'Ví dụ: {"buy": 2, "get": 1} — mua 2 tặng 1'}
                          {watchedType === "percent_by_qty" && 'Ví dụ: {"3": 10, "5": 20} — mua 3+ giảm 10%, mua 5+ giảm 20%'}
                          {watchedType === "topup" && 'Ví dụ: {"50000": 57000} — nạp 50k nhận 57k'}
                          {watchedType === "tiered" && 'Ví dụ: {"100000": 5, "500000": 10} — đơn 100k giảm 5%'}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {!needsTiers && (
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground -mt-2" onClick={() => setShowTiers(v => !v)}>
                    {showTiers ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                    {showTiers ? "Ẩn cấu hình bậc" : "Thêm cấu hình bậc (tùy chọn)"}
                  </Button>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="appliesTo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phạm vi</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="all">Tất cả SP</SelectItem>
                            <SelectItem value="category">Theo danh mục</SelectItem>
                            <SelectItem value="product">Theo SP</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customerTarget"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Đối tượng</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="all">Tất cả</SelectItem>
                            <SelectItem value="new">KH mới</SelectItem>
                            <SelectItem value="existing">KH cũ</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ưu tiên</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" placeholder="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bắt đầu</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Kết thúc</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} data-testid="input-promo-enddate" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={createPromotion.isPending || updatePromotion.isPending}>
                  {createPromotion.isPending || updatePromotion.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Lưu khuyến mãi
                </Button>
              </form>
            </Form>
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
                  <TableHead>Tên KM</TableHead>
                  <TableHead>Loại</TableHead>
                  <TableHead>Phạm vi</TableHead>
                  <TableHead>Đối tượng</TableHead>
                  <TableHead>Bậc</TableHead>
                  <TableHead>Hết hạn</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promotionList?.data?.map((promo) => (
                  <TableRow key={promo.id} data-testid={`row-promo-${promo.id}`}>
                    <TableCell className="font-medium">
                      <div>
                        <p>{promo.name}</p>
                        {promo.description && <p className="text-xs text-muted-foreground">{promo.description}</p>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {PROMOTION_TYPES.find(t => t.value === promo.type)?.label?.split(" (")[0] ?? promo.type}
                    </TableCell>
                    <TableCell className="text-sm">{promo.appliesTo === 'all' ? 'Tất cả' : promo.appliesTo}</TableCell>
                    <TableCell className="text-sm">{
                      promo.customerTarget === 'new' ? 'KH mới' :
                      promo.customerTarget === 'existing' ? 'KH cũ' : 'Tất cả'
                    }</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground max-w-[80px] truncate" title={promo.tiers ? JSON.stringify(promo.tiers) : undefined}>
                      {promo.tiers ? "✓" : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{promo.endDate ? formatDate(promo.endDate) : "∞"}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${promo.isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"}`}>
                        {promo.isActive ? "Đang chạy" : "Tạm dừng"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(promo)} data-testid={`btn-edit-promo-${promo.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(promo.id)} data-testid={`btn-delete-promo-${promo.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {promotionList?.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      Không có khuyến mãi nào.
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
