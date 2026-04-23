import { useGetPaymentConfig, useSavePaymentConfig, getGetPaymentConfigQueryKey } from "@workspace/api-client-react";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CreditCard, Copy, Check, Webhook, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Switch } from "@/components/ui/switch";

const paymentSchema = z.object({
  bankName: z.string().min(1, "Tên ngân hàng là bắt buộc"),
  bankCode: z.string().optional(),
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
  const [copied, setCopied] = useState(false);
  
  const { data: config, isLoading } = useGetPaymentConfig({
    query: { queryKey: getGetPaymentConfigQueryKey() }
  });

  const saveConfig = useSavePaymentConfig();

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      bankName: "",
      bankCode: "",
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
        bankCode: config.bankCode || "",
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
      bankCode: data.bankCode || undefined,
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
          toast({ title: "✓ Đã lưu cấu hình thanh toán", description: "Cài đặt SePay đã được cập nhật thành công." });
          queryClient.invalidateQueries({ queryKey: getGetPaymentConfigQueryKey() });
        },
        onError: () => {
          toast({ title: "Lưu thất bại", description: "Không thể lưu cấu hình. Vui lòng thử lại.", variant: "destructive" });
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

  const webhookUrl = config?.webhookUrl ?? null;
  const handleCopyWebhook = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast({ title: "Đã sao chép URL webhook" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Không thể sao chép", description: "Vui lòng chọn và sao chép thủ công.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cấu hình Thanh toán</h1>
        <p className="text-muted-foreground mt-1">Cài đặt API SePay để nhận thanh toán tự động.</p>
      </div>

      <Card className="max-w-2xl" data-testid="card-sepay-webhook">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-primary" />
            Webhook URL cho SePay
          </CardTitle>
          <CardDescription>
            Sao chép URL bên dưới và dán vào mục <b>Cấu hình Webhook</b> trên trang quản trị SePay.
            Khi có giao dịch chuyển khoản đến, SePay sẽ gọi URL này để hệ thống tự động xác nhận đơn hàng.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {webhookUrl ? (
            <div className="flex gap-2">
              <Input
                readOnly
                value={webhookUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-sm"
                data-testid="input-webhook-url"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleCopyWebhook}
                data-testid="button-copy-webhook"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-2 hidden sm:inline">{copied ? "Đã copy" : "Sao chép"}</span>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-no-webhook-url">
              Chưa xác định được domain công khai. Hãy publish app để có URL webhook.
            </p>
          )}
          <div className="rounded-md border border-border bg-accent/30 p-3 text-xs text-muted-foreground space-y-1">
            <p><b>Phương thức:</b> POST</p>
            <p><b>Xác thực:</b> Header <code className="bg-muted px-1 rounded">Authorization: Apikey &lt;SePay API Key&gt;</code></p>
            <p><b>Nội dung CK cần khớp:</b> mã đơn hàng dạng <code className="bg-muted px-1 rounded">DH********</code> (10 ký tự)</p>
          </div>
        </CardContent>
      </Card>

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
                      <FormLabel>Tên ngân hàng</FormLabel>
                      <FormControl>
                        <Input placeholder="VD: Vietcombank, MB Bank..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bankCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mã ngân hàng (cho QR)</FormLabel>
                      <FormControl>
                        <Input placeholder="VD: VCB, MB, TCB..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
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
                    <FormLabel>SePay API Key</FormLabel>
                    {config?.apiKey && (
                      <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 font-medium" data-testid="badge-api-key-set">
                        <ShieldCheck className="h-4 w-4 shrink-0" />
                        <span>API key đã được lưu ({config.apiKey})</span>
                      </div>
                    )}
                    <FormControl>
                      <Input type="password" placeholder={config?.apiKey ? "Nhập key mới để thay thế" : "Key lấy từ sepay.vn"} {...field} />
                    </FormControl>
                    <FormDescription data-testid="hint-api-key">
                      {config?.apiKey
                        ? "Để trống để giữ nguyên API key hiện tại. Nhập giá trị mới để thay thế."
                        : "Nhập API key từ trang quản trị sepay.vn."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="webhookSecret"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Webhook Secret (Tùy chọn)</FormLabel>
                    {config?.webhookSecret && (
                      <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 font-medium" data-testid="badge-webhook-secret-set">
                        <ShieldCheck className="h-4 w-4 shrink-0" />
                        <span>Webhook secret đã được lưu ({config.webhookSecret})</span>
                      </div>
                    )}
                    <FormControl>
                      <Input type="password" placeholder={config?.webhookSecret ? "Nhập secret mới để thay thế" : "Bảo mật webhook"} {...field} />
                    </FormControl>
                    <FormDescription data-testid="hint-webhook-secret">
                      {config?.webhookSecret
                        ? "Để trống để giữ nguyên webhook secret hiện tại. Nhập giá trị mới để thay thế."
                        : "Nhập webhook secret từ trang quản trị sepay.vn (nếu có)."}
                    </FormDescription>
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
