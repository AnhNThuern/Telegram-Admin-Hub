import { useListPromotions, useCreatePromotion, useUpdatePromotion, useDeletePromotion, getListPromotionsQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { formatVND, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const promotionSchema = z.object({
  name: z.string().min(1, "Tên khuyến mãi là bắt buộc"),
  description: z.string().optional(),
  type: z.string().default("percentage"),
  appliesTo: z.string().default("all"),
  isActive: z.boolean().default(true),
});

type PromotionFormValues = z.infer<typeof promotionSchema>;

export default function Promotions() {
  const { data: promotionList, isLoading } = useListPromotions();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
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
      isActive: true,
    },
  });

  const onSubmit = (data: PromotionFormValues) => {
    if (editingId) {
      updatePromotion.mutate(
        { id: editingId, data },
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
        { data },
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

  const handleEdit = (promo: any) => {
    setEditingId(promo.id);
    form.reset({
      name: promo.name,
      description: promo.description || "",
      type: promo.type,
      appliesTo: promo.appliesTo,
      isActive: promo.isActive,
    });
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
          <p className="text-muted-foreground mt-1">Quản lý mã giảm giá và chương trình khuyến mãi.</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingId(null); form.reset(); }} data-testid="btn-add-promotion">
              <Plus className="h-4 w-4 mr-2" /> Thêm khuyến mãi
            </Button>
          </DialogTrigger>
          <DialogContent>
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
                      <FormLabel>Tên khuyến mãi</FormLabel>
                      <FormControl>
                        <Input placeholder="VD: Giảm 10% khách mới" {...field} />
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
                      <FormLabel>Loại giảm giá</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Chọn loại" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="percentage">Phần trăm (%)</SelectItem>
                          <SelectItem value="fixed">Số tiền cố định</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createPromotion.isPending || updatePromotion.isPending}>
                  {createPromotion.isPending || updatePromotion.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Lưu
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
                  <TableHead>Áp dụng</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promotionList?.data?.map((promo) => (
                  <TableRow key={promo.id}>
                    <TableCell className="font-medium">{promo.name}</TableCell>
                    <TableCell>{promo.type === 'percentage' ? 'Phần trăm' : 'Cố định'}</TableCell>
                    <TableCell>{promo.appliesTo}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${promo.isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"}`}>
                        {promo.isActive ? "Đang chạy" : "Tạm dừng"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(promo)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(promo.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {promotionList?.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
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
