import { prisma } from "@/lib/prisma";

export default async function HelpCenterPage() {
  const articles = await prisma.knowledgeArticle.findMany({
    orderBy: { category: "asc" }
  });

  // Group by category
  const categories = (articles as any[]).reduce((acc: any, article: any) => {
    if (!acc[article.category]) acc[article.category] = [];
    acc[article.category].push(article);
    return acc;
  }, {} as Record<string, typeof articles>);

  return (
    <div className="bg-slate-50 min-h-screen py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight mb-4">
            How can we help you?
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            Find answers to common questions about jobs, our application process, and required documents. Alternatively, click the chat icon below to talk to our AI Assistant.
          </p>
        </div>

        {Object.keys(categories).length === 0 ? (
          <div className="text-center p-12 bg-white rounded-2xl border border-slate-200 shadow-sm text-slate-400">
            Knowledge Base is currently empty. Our team is adding guides shortly.
          </div>
        ) : (
          <div className="space-y-12">
            {Object.entries(categories).map(([category, items]) => (
              <div key={category} className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-3 mb-6 pb-6 border-b border-slate-100">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 text-xl font-bold">
                    {category.charAt(0)}
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800">{category}</h2>
                </div>
                
                <div className="grid gap-6">
                  {(items as any[]).map((item: any) => (
                    <details key={item.id} className="group bg-slate-50 rounded-2xl overflow-hidden [&_summary::-webkit-details-marker]:hidden">
                      <summary className="cursor-pointer font-bold text-lg text-slate-800 p-6 flex items-center justify-between hover:bg-slate-100 transition-colors">
                        {item.title}
                        <span className="text-emerald-600 transition group-open:rotate-180 bg-white shadow-sm w-8 h-8 flex items-center justify-center rounded-full border border-slate-200">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </span>
                      </summary>
                      <div className="px-6 pb-6 text-slate-600 leading-relaxed max-w-3xl border-t border-slate-200/60 pt-4 whitespace-pre-wrap">
                        {item.content}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
