import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for Vertex International Recruitment.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="bg-slate-50 min-h-screen py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-2xl p-8 md:p-12 shadow-sm border border-slate-100">
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 mb-8 border-b border-slate-100 pb-4">Privacy Policy</h1>
          
          <div className="prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-emerald-800 prose-a:text-emerald-600">
            <p className="text-slate-500 text-sm mb-8">Last Updated: {new Date().toLocaleDateString()}</p>

            <h2>1. Introduction</h2>
            <p>
              Welcome to Vertex International Recruitment. We respect your privacy and are committed to protecting your personal data. 
              This privacy policy will inform you about how we look after your personal data when you visit our website 
              (regardless of where you visit it from) and tell you about your privacy rights and how the law protects you.
            </p>

            <h2>2. The Data We Collect About You</h2>
            <p>
              We may collect, use, store and transfer different kinds of personal data about you which we have grouped together as follows:
            </p>
            <ul>
              <li><strong>Identity Data:</strong> includes first name, last name, username or similar identifier, marital status, title, date of birth and gender.</li>
              <li><strong>Contact Data:</strong> includes billing address, delivery address, email address and telephone numbers.</li>
              <li><strong>Professional Data:</strong> includes CVs, resumes, employment history, qualifications, skills, and passport/visa status.</li>
              <li><strong>Technical Data:</strong> includes internet protocol (IP) address, browser type and version, time zone setting and location.</li>
            </ul>

            <h2>3. How We Use Your Personal Data</h2>
            <p>
              We will only use your personal data when the law allows us to. Most commonly, we will use your personal data in the following circumstances:
            </p>
            <ul>
              <li>To match your profile with relevant international job opportunities.</li>
              <li>To process your job applications and submit your profile to potential employers.</li>
              <li>To manage visa processing and relocation logistics.</li>
              <li>To answer your inquiries and communicate with you effectively.</li>
            </ul>

            <h2>4. Data Security</h2>
            <p>
              We have put in place appropriate security measures to prevent your personal data from being accidentally lost, used, or accessed in an unauthorized way, altered, or disclosed.
              Your data is encrypted safely in our databases and transmitted securely over TLS connections.
            </p>

            <h2>5. Contact Us</h2>
            <p>
              If you have any questions about this privacy policy or our privacy practices, please contact us at: <br />
              <strong>WhatsApp:</strong> +44 7438 613251 <br />
              <strong>Office:</strong> +44 20 3026 3403 <br />
              <strong>Email:</strong> vertex@vertexintern.com
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
