import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for Vertex International Recruitment.",
};

export default function TermsOfServicePage() {
  return (
    <div className="bg-slate-50 min-h-screen py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-2xl p-8 md:p-12 shadow-sm border border-slate-100">
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-8 border-b border-slate-100 pb-4">Terms of Service</h1>
          
          <div className="prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-emerald-800 prose-a:text-emerald-600">
            <p className="text-slate-500 text-sm mb-8">Last Updated: {new Date().toLocaleDateString()}</p>

            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing and using the Vertex International Recruitment website (the "Service"), you accept and agree to be bound by the terms and provision of this agreement. 
              If you do not agree to abide by the above, please do not use this service.
            </p>

            <h2>2. Description of Service</h2>
            <p>
              Vertex International Recruitment provides a platform bridging candidates with international employers. 
              We offer job matching, application tracking, visa consulting, and relocation assistance. We reserve the right to 
              modify or discontinue, temporarily or permanently, the Service (or any part thereof) with or without notice.
            </p>

            <h2>3. User Responsibilities</h2>
            <p>
              You must provide accurate, current, and complete information as prompted by the registration and application forms on the Service. 
              You are entirely responsible for maintaining the confidentiality of your account information. You agree not to upload false documents, 
              counterfeit passports, or fake certifications.
            </p>

            <h2>4. Payments and Fees</h2>
            <p>
              Certain services, such as consultation fees, application processing, or visa assistance, may require payment. 
              All fees are clearly stated before any transaction is required. Vertex International ensures that all payments are processed securely through authorized partners (Stripe & PayPal).
            </p>

            <h2>5. Disclaimer of Liability</h2>
            <p>
              While we strive to connect you with the best employers abroad, we do not guarantee job placement or visa approval, 
              as these rely on third-party employers and immigration authorities. Vertex International shall not be liable for any direct, 
              indirect, incidental, special, or consequential damages resulting from the use or inability to use the Service.
            </p>

            <h2>6. Contact Information</h2>
            <p>
              If you have any questions regarding these Terms, please contact us at vertex@vertexintern.com.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
