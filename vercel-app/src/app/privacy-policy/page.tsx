import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Elite Eco Car Wash",
  robots: { index: false },
};

const COPY = {
  en: {
    title: "Privacy Policy",
    back: "← Back to booking",
    body: [
      "We collect your name, email address and mobile number solely to manage your booking: to confirm, reschedule or cancel your appointment and to contact you about it.",
      "Bookings are processed through Cal.com, our scheduling provider, which stores your booking details on our behalf. We do not sell or share your information with anyone else.",
      "Messages you send to Eco, our AI assistant, are processed to generate a reply and are not used to identify you.",
      "We also keep internal records to serve you and run the business — your visit and order history, together with private notes and tags we may add about your preferences and service. These are kept until you ask us to erase them.",
      "To ask about or delete your data, write to info@eliteecocarwash.com.",
    ],
  },
  ar: {
    title: "سياسة الخصوصية",
    back: "← العودة إلى الحجز",
    body: [
      "نجمع اسمك وعنوان بريدك الإلكتروني ورقم هاتفك المحمول فقط لإدارة حجزك: لتأكيد أو إعادة جدولة أو إلغاء موعدك والتواصل معك بشأنه.",
      "تتم معالجة الحجوزات عبر Cal.com — مزود خدمة الجدولة الخاص بنا، والذي يخزن بيانات الحجز نيابة عنا. نحن لا نبيع أو نشارك معلوماتك مع أي طرف آخر.",
      "الرسائل التي ترسلها إلى Eco، مساعد الذكاء الاصطناعي لدينا، تتم معالجتها لإنشاء رد ولا تُستخدم للتعرف عليك.",
      "نحتفظ أيضاً بسجلات داخلية لخدمتك وإدارة الأعمال — سجل زياراتك وطلباتك، بالإضافة إلى ملاحظات وعلامات خاصة قد نضيفها عن تفضيلاتك. يتم الاحتفاظ بها حتى تطلب منا حذفها.",
      "للاستفسار عن بياناتك أو حذفها، اكتب لنا على info@eliteecocarwash.com.",
    ],
  },
} as const;

export default async function PrivacyPolicy({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  const t = COPY[lang === "ar" ? "ar" : "en"];
  const backHref = lang === "ar" ? "/book?lang=ar" : "/book";

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-serif text-3xl text-foreground">{t.title}</h1>
      <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
        {t.body.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <p className="mt-10">
        <Link href={backHref} className="text-primary underline underline-offset-4">
          {t.back}
        </Link>
      </p>
    </main>
  );
}