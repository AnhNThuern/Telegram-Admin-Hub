import { useListCategories, useCreateCategory, useUpdateCategory, useDeleteCategory, getListCategoriesQueryKey, Category } from "@workspace/api-client-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const SUGGESTED_ICONS = ["🎮", "🎁", "💻", "📱", "🔑", "🛒", "🎵", "📺", "🎬", "🔧", "💎", "🏆", "📦", "🌟", "🎯", "🖥️", "⌚", "📷", "🎧", "🧩"];

const categorySchema = z.object({
  name: z.string().min(1, "Tên danh mục là bắt buộc"),
  icon: z.string().max(10, "Icon quá dài").optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

type CategoryFormValues = z.infer<typeof categorySchema>;

export default function Categories() {
  const { data: categoryList, isLoading } = useListCategories();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: "",
      icon: "",
      isActive: true,
    },
  });

  const onSubmit = (data: CategoryFormValues) => {
    const trimmedIcon = data.icon?.trim();
    const payload = {
      name: data.name,
      // For updates, send trimmedIcon even when "" so the backend clears an
      // existing icon. For creates, omit when empty (DB defaults to null).
      icon: editingId !== null ? trimmedIcon : trimmedIcon || undefined,
      isActive: data.isActive,
    };
    if (editingId !== null) {
      updateCategory.mutate(
        { id: editingId, data: payload },
        {
          onSuccess: () => {
            toast({ title: "Đã cập nhật danh mục" });
            setIsAddOpen(false);
            setEditingId(null);
            queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
          },
        }
      );
    } else {
      createCategory.mutate(
        { data: payload },
        {
          onSuccess: () => {
            toast({ title: "Đã tạo danh mục" });
            setIsAddOpen(false);
            form.reset();
            queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
          },
        }
      );
    }
  };

  const handleEdit = (category: Category) => {
    setEditingId(category.id);
    form.reset({ name: category.name, icon: category.icon ?? "", isActive: category.isActive });
    setIsAddOpen(true);
  };

  const handleDelete = (id: number) => {
    if (!confirm("Bạn có chắc chắn muốn xóa danh mục này?")) return;
    deleteCategory.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Đã xóa danh mục" });
          queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Danh mục</h1>
          <p className="text-muted-foreground mt-1">Quản lý các danh mục sản phẩm.</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingId(null); form.reset(); }} data-testid="btn-add-category">
              <Plus className="h-4 w-4 mr-2" /> Thêm danh mục
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Cập nhật danh mục" : "Thêm danh mục mới"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tên danh mục</FormLabel>
                      <FormControl>
                        <Input placeholder="VD: Netflix, Spotify..." {...field} data-testid="input-category-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="icon"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Icon (emoji)</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Input
                              placeholder="VD: 🎮"
                              maxLength={10}
                              {...field}
                              data-testid="input-category-icon"
                              className="w-24 text-center text-xl"
                            />
                            {field.value && (
                              <span className="text-2xl leading-none">{field.value}</span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5" data-testid="icon-suggestions">
                            {SUGGESTED_ICONS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => field.onChange(emoji)}
                                className={`rounded-md border px-2 py-1 text-lg transition-colors hover:bg-accent ${field.value === emoji ? "border-primary bg-accent" : "border-border"}`}
                                data-testid={`icon-chip-${emoji}`}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      </FormControl>
                      <FormDescription>Chọn từ gợi ý hoặc nhập emoji trực tiếp. Để trống để dùng icon mặc định 📁.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                      <div>
                        <FormLabel className="text-sm font-medium">Đang hoạt động</FormLabel>
                        <FormDescription className="text-xs">Hiển thị danh mục cho khách hàng</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-category-active" />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createCategory.isPending || updateCategory.isPending}>
                  {createCategory.isPending || updateCategory.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
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
                  <TableHead>ID</TableHead>
                  <TableHead>Icon</TableHead>
                  <TableHead>Tên danh mục</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryList?.data?.map((category) => (
                  <TableRow key={category.id} data-testid={`row-category-${category.id}`}>
                    <TableCell className="font-mono text-xs">{category.id}</TableCell>
                    <TableCell className="text-xl" data-testid={`icon-category-${category.id}`}>
                      {category.icon || "📁"}
                    </TableCell>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${category.isActive ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"}`}>
                        {category.isActive ? "Đang hoạt động" : "Đã ẩn"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(category)} data-testid={`btn-edit-category-${category.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(category.id)} data-testid={`btn-delete-category-${category.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {categoryList?.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      Chưa có danh mục nào.
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
