import 'package:flutter/material.dart';
import '../../app/theme/colors.dart';
import '../shared/vertex_app_bar_leading.dart';
import '../director/director_drawer.dart';

class ManagementBackupScreen extends StatelessWidget {
  const ManagementBackupScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const DirectorDrawer(activeRoute: '/management/backup'),
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: const VertexAppBarLeading(),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'DATA',
              style: TextStyle(
                color: VertexColors.gold300,
                fontSize: 9,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.2,
              ),
            ),
            SizedBox(height: 4),
            Text(
              'Backup',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          const Text(
            'Backup.',
            style: TextStyle(
              color: VertexColors.midnight900,
              fontSize: 28,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Download full CSV backups of your organization\'s data. These exports include all records and are generated in real-time.',
            style: TextStyle(
              color: VertexColors.gray600,
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 24),

          // Export Cards
          _buildExportCard(
            context,
            title: 'Candidates',
            description:
                'Full candidate roster including profile, contact, and lifecycle data.',
            icon: Icons.people_outline,
            filename: 'candidates_backup.csv',
          ),
          _buildExportCard(
            context,
            title: 'Cases',
            description:
                'Mobility cases with current stage, document status, and payment tracking.',
            icon: Icons.flight_takeoff,
            filename: 'cases_backup.csv',
          ),
          _buildExportCard(
            context,
            title: 'Partners',
            description:
                'Partner CRM data including travel agencies, MOUs, and sourced candidates.',
            icon: Icons.handshake_outlined,
            filename: 'partners_backup.csv',
          ),
          _buildExportCard(
            context,
            title: 'Employer Clients',
            description:
                'Employer client directory, contact details, and linked job postings.',
            icon: Icons.business_outlined,
            filename: 'employer_clients_backup.csv',
          ),
          _buildExportCard(
            context,
            title: 'Reports',
            description:
                'All submitted recruiter, supervisor, and portfolio reports with status.',
            icon: Icons.description_outlined,
            filename: 'reports_backup.csv',
          ),
        ],
      ),
    );
  }

  Widget _buildExportCard(
    BuildContext context, {
    required String title,
    required String description,
    required IconData icon,
    required String filename,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: VertexColors.ivory200),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _downloadFile(context, filename),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: VertexColors.ivory100,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: VertexColors.gold600, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                        color: VertexColors.midnight900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      description,
                      style: const TextStyle(
                        color: VertexColors.gray600,
                        fontSize: 12,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              // Download Button
              IconButton(
                onPressed: () => _downloadFile(context, filename),
                icon: const Icon(Icons.download, color: VertexColors.midnight800),
                style: IconButton.styleFrom(
                  backgroundColor: VertexColors.ivory50,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: const BorderSide(color: VertexColors.ivory200),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _downloadFile(BuildContext context, String filename) {
    // In production, replace this with a real download handler.
    // Example using url_launcher:
    // launchUrl(Uri.parse('https://your-api.com/api/admin/backup/$filename'));

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: VertexColors.midnight800,
        content: Text(
          'Downloading $filename...',
          style: const TextStyle(color: Colors.white),
        ),
        duration: const Duration(seconds: 2),
      ),
    );
  }
}
