import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/colors.dart';
import '../../app/theme/typography.dart';
import '../shared/recruiter_drawer.dart';
import '../shared/vertex_app_bar_leading.dart';

class MyCandidatesScreen extends StatefulWidget {
  const MyCandidatesScreen({super.key});

  @override
  State<MyCandidatesScreen> createState() => _MyCandidatesScreenState();
}

class _MyCandidatesScreenState extends State<MyCandidatesScreen> {
  final TextEditingController _searchController = TextEditingController();
  String? _selectedStatus = 'All statuses';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: VertexColors.ivory50,
      drawer: const RecruiterDrawer(activeRoute: '/recruiter/candidates'),
      
      // --- APP BAR (Top register button removed) ---
      appBar: AppBar(
        backgroundColor: VertexColors.midnight950,
        toolbarHeight: 76,
        leading: const VertexAppBarLeading(),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'RECRUITER WORKSPACE',
              style: VertexTypography.eyebrow.copyWith(
                color: VertexColors.gold300,
                fontSize: 9,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'My Candidates',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        // NOTE: The `actions` property has been intentionally removed.
      ),

      // NOTE: The `floatingActionButton` property has been intentionally removed.

      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 22, 18, 32),
        children: [
          // --- Search Bar ---
          TextField(
            controller: _searchController,
            cursorColor: VertexColors.gold600,
            style: const TextStyle(
              color: VertexColors.gold600,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
            decoration: InputDecoration(
              hintText: 'Search candidates...',
              hintStyle: const TextStyle(
                color: VertexColors.gray400,
                fontSize: 13,
              ),
              prefixIcon: const Icon(
                Icons.search,
                color: VertexColors.gold600,
                size: 20,
              ),
              filled: true,
              fillColor: Colors.white,
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(11),
                borderSide: const BorderSide(color: VertexColors.ivory200),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(11),
                borderSide: const BorderSide(color: VertexColors.ivory200),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(11),
                borderSide: const BorderSide(color: VertexColors.gold600, width: 1.4),
              ),
            ),
          ),
          const SizedBox(height: 12),

          // --- Status Filter ---
          DropdownButtonFormField<String>(
            initialValue: _selectedStatus,
            isExpanded: true,
            style: const TextStyle(
              color: VertexColors.gold600,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
            dropdownColor: Colors.white,
            iconEnabledColor: VertexColors.gold600,
            decoration: InputDecoration(
              filled: true,
              fillColor: Colors.white,
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(11),
                borderSide: const BorderSide(color: VertexColors.ivory200),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(11),
                borderSide: const BorderSide(color: VertexColors.ivory200),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(11),
                borderSide: const BorderSide(color: VertexColors.gold600, width: 1.4),
              ),
            ),
            items: ['All statuses', 'Pending', 'Screened', 'Reported']
                .map((status) => DropdownMenuItem<String>(
                      value: status,
                      child: Text(
                        status,
                        style: const TextStyle(
                          color: VertexColors.gold600,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ))
                .toList(),
            onChanged: (value) => setState(() => _selectedStatus = value),
          ),
          const SizedBox(height: 48),

          // --- Empty State ---
          Center(
            child: Column(
              children: [
                Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    color: VertexColors.ivory100,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.people_outline,
                    color: VertexColors.midnight500,
                    size: 36,
                  ),
                ),
                const SizedBox(height: 24),
                const Text(
                  'No candidates yet',
                  style: TextStyle(
                    color: VertexColors.midnight900,
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Register your first intake record to start building your pipeline.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: VertexColors.gray600,
                    fontSize: 13,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 32),

                // --- THE ONLY REGISTER BUTTON ---
                SizedBox(
                  width: 280,
                  height: 52,
                  child: ElevatedButton.icon(
                    onPressed: () {
                      context.push('/recruiter/intake');
                    },
                    icon: const Icon(Icons.person_add_alt_1, color: Colors.white, size: 20),
                    label: const Text(
                      'REGISTER CANDIDATE',
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.1,
                        fontSize: 13,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: VertexColors.midnight800,
                      foregroundColor: Colors.white,
                      shape: const StadiumBorder(),
                      elevation: 0,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}