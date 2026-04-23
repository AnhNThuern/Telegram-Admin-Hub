import { useGetSystemSettings, useUpdateSystemSettings, getGetSystemSettingsQueryKey } from "@workspace/api-client-react";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RotateCcw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({
  maxRetryCount: z.coerce.number().int().min(1).max(1000),
  maxOrderAgeDays: z.coerce.number().int().min(1).max(365),
  stockRequestWindowHours: z.coerce.number().int().min(1).max(168),
});

type FormValues = z.infer<typeof schema>;

export default function SettingsRetry() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: settings, isLoading } = useGetSystemSettings({
    query: { queryKey: getGetSystemSettingsQueryKey() },
  });

  const updateSettings = useUpdateSystemSettings();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { maxRetryCount: 10, maxOrderAgeDays: 7, stockRequestWindowHours: 24 },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        maxRetryCount: settings.maxRetryCount,
        maxOrderAgeDays: settings.maxOrderAgeDays,
        stockRequestWindowHours: settings.stockRequestWindowHours ?? 24,
      });
    }
  }, [settings, form]);

  const onSubmit = (data: FormValues) => {
    updateSettings.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: "Đã lưu cấu hình quét lại đơn" });
          queryClient.invalidateQueries({ queryKey: getGetSystemSettingsQueryKey() });
        },
        onError: () => {
          toast({ variant: "destructive", title: "Không lưu được cấu hình" });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cấu hình quét lại đơn</h1>
        <p className="text-muted-foreground mt-1">
          Đặt giới hạn cho việc tự động thử giao lại các đơn bị kẹt. Thay đổi có hiệu lực ngay ở lần quét tiếp theo.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-primary" />
            Giới hạn thử giao lại
          </CardTitle>
          <CardDescription>
            Khi đơn vượt quá một trong hai giới hạn dưới đây, hệ thống sẽ đánh dấu đơn là <code>retry_exhausted</code> và gửi cảnh báo cho admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="maxRetryCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Số lần thử tối đa</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        data-testid="input-max-retry-count"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Mặc định: 10. Đơn sẽ ngừng được thử lại sau khi đạt số lần này.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxOrderAgeDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tuổi đơn tối đa (ngày)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        data-testid="input-max-order-age-days"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Mặc định: 7. Đơn cũ hơn số ngày này sẽ bị đánh dấu hết lượt thử ngay cả khi chưa đạt giới hạn số lần thử.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="stockRequestWindowHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cửa sổ yêu cầu tồn kho (giờ)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={168}
                        data-testid="input-stock-request-window-hours"
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Mặc định: 24. Khoảng thời gian (tính bằng giờ) mà trong đó khách hàng không thể yêu cầu thông báo tồn kho cho cùng một sản phẩm. Tối thiểu 1 giờ, tối đa 168 giờ (7 ngày).
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end pt-2">
                <Button
                  type="submit"
                  disabled={updateSettings.isPending}
                  data-testid="btn-save-retry-settings"
                >
                  {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Lưu cấu hình
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
