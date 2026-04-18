import { useGetPaymentConfig, useSavePaymentConfig, getGetPaymentConfigQueryKey } from "@workspace/api-client-react";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CreditCard } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Switch } from "@/components/ui/switch";

const paymentSchema = z.object({
  bankName: z.string().min(1, "Tên ngân hàng là bắt buộc"),
  accountNumber: z.string().min(1, "Số tài khoản là bắt buộc"),
  accountHolder: z.string().min(1, "Tên chủ tài khoản là bắt buộc"),
  apiKey: z.string().optional(),
  webhookSecret: z.string().optional(),
  isActive: z.boolean().default(true),
});

type PaymentFormValues = z.infer<typeof paymentSchema>;

export default function SettingsPayments() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: config, isLoading } = useGetPaymentConfig({
    query: { queryKey: getGetPaymentConfigQueryKey() }
  });

  const saveConfig = useSavePaymentConfig();

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      bankName: "",
      accountNumber: "",
      accountHolder: "",
      apiKey: "",
      webhookSecret: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (config) {
      form.reset({
        bankName: config.bankName || "",
        accountNumber: config.accountNumber || "",
        accountHolder: config.accountHolder || "",
        apiKey: "",
        webhookSecret: "",
        isActive: config.isActive,
      });
    }
  }, [config, form]);

  const isMasked = (val: string) => /^\*+$/.test(val.trim());

  const onSubmit = (data: PaymentFormValues) => {
    const payload: Record<string, unknown> = {
      bankName: data.bankName,
      accountNumber: data.accountNumber,
      accountHolder: data.accountHolder,
      isActive: data.isActive,
    };
    if (data.apiKey && !isMasked(data.apiKey)) payload.apiKey = data.apiKey;
    if (data.webhookSecret && !isMasked(data.webhookSecret)) payload.webhookSecret = data.webhookSecret;

    saveConfig.mutate(
      { data: payload as Parameters<typeof saveConfig.mutate>[0]['data'] },
      {
        onSuccess: () => {
          toast({ title: "Đã lưu cấu hình thanh toán" });
          queryClient.invalidateQueries({ queryKey: getGetPaymentConfigQueryKey() });
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
        <h1 className="text-3xl font-bold tracking-tight">Cấu hình Thanh toán</h1>
        <p className="text-muted-foreground mt-1">Cài đặt API SePay để nhận thanh toán tự động.</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Cấu hình SePay
          </CardTitle>
          <CardDescription>Hệ thống tự động xác nhận giao dịch qua SePay</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="bankName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ngân hàng (Tên viết tắt)</FormLabel>
                      <FormControl>
                        <Input placeholder="VD: MBBank, VCB..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="accountNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Số tài khoản</FormLabel>
                      <FormControl>
                        <Input placeholder="Số tài khoản nhận tiền" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="accountHolder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tên chủ tài khoản</FormLabel>
                    <FormControl>
                      <Input placeholder="NGUYEN VAN A" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="apiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SePay API Key {config?.apiKey && <span className="text-xs text-muted-foreground font-normal ml-1">(để trống = giữ nguyên)</span>}</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder={config?.apiKey ? "Để trống để giữ nguyên key hiện tại" : "Key lấy từ sepay.vn"} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="webhookSecret"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Webhook Secret (Tùy chọn) {config?.webhookSecret && <span className="text-xs text-muted-foreground font-normal ml-1">(để trống = giữ nguyên)</span>}</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder={config?.webhookSecret ? "Để trống để giữ nguyên secret hiện tại" : "Bảo mật webhook"} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4 bg-accent/30">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Kích hoạt thanh toán</FormLabel>
                      <CardDescription>
                        Bật/tắt khả năng tạo đơn hàng mới trên Bot
                      </CardDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={saveConfig.isPending} className="w-full mt-4">
                {saveConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Lưu cấu hình
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
