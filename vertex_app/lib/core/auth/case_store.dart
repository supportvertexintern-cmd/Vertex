import 'package:flutter/foundation.dart';

import '../../data/repositories/case_repository.dart';
import '../../data/services/api_service.dart';

/// A case's status on the server (CaseStatus in vertex_be): a case is
/// worked on until it's rejected; its progress is its [CaseRecord.stage].
enum CaseStatus { active, rejected }

/// The Operational Workflow SOP's 11 stages (CaseStage in vertex_be), as
/// the lists show them.
const caseStageLabels = <String, String>{
  'registration_document_submission': 'Registration & documents',
  'document_preparation_legalization': 'Document legalization',
  'permit_application_submission': 'Permit application',
  'permit_processing_followup': 'Permit processing',
  'permit_authorization_approved': 'Permit approved',
  'original_documents_dispatch': 'Documents dispatched',
  'partner_receives_permit': 'Partner has the permit',
  'visa_interview_preparation': 'Visa interview preparation',
  'visa_interview_decision': 'Visa decision',
  'pre_departure_arrangements': 'Pre-departure',
  'departure_arrival_support': 'Departure & arrival',
};

/// A case as the lists show it: a row of GET /api/v1/cases. Cases open
/// when an application is approved (or HR converts a partner submission);
/// the app never creates one.
class CaseRecord {
  const CaseRecord({
    required this.id,
    required this.candidateName,
    required this.nationality,
    required this.destination,
    required this.jobTitle,
    required this.stage,
    required this.status,
    required this.createdAt,
  });

  factory CaseRecord.fromJson(Map<String, dynamic> json) {
    Map map(Object? v) => v is Map ? v : const {};
    String text(Object? v) => v is String ? v : '';
    final application = map(json['application']);
    final candidate = map(application['candidate']);
    final user = map(candidate['user']);
    final job = map(application['job']);
    final stage = text(json['current_stage']);
    return CaseRecord(
      id: json['id'] as String,
      candidateName: text(candidate['full_name']).isNotEmpty ? text(candidate['full_name']) : text(user['full_name']),
      nationality: text(candidate['nationality']),
      destination: [text(job['city']), text(job['country'])].where((s) => s.isNotEmpty).join(', '),
      jobTitle: text(job['title']),
      stage: caseStageLabels[stage] ?? stage,
      status: text(json['status']) == 'rejected' ? CaseStatus.rejected : CaseStatus.active,
      createdAt: DateTime.tryParse(text(json['created_at']))?.toLocal() ?? DateTime.now(),
    );
  }

  final String id;
  final String candidateName;
  final String nationality;
  final String destination;
  final String jobTitle;

  /// Where the case is, in words (e.g. "Permit processing").
  final String stage;
  final CaseStatus status;
  final DateTime createdAt;
}

/// The signed-in user's cases, loaded from FastAPI; read-only in the app.
class CaseStore extends ChangeNotifier {
  CaseStore(this._repository);
  final CaseRepository? _repository;

  /// For tests: no server.
  CaseStore.offline() : _repository = null;

  List<CaseRecord> _records = const [];
  int _generation = 0;
  int total = 0;
  bool isLoading = false;
  bool hasLoaded = false;
  String? loadError;

  List<CaseRecord> get records => List.unmodifiable(_records);

  Future<void> load() async {
    final repository = _repository;
    if (repository == null) return;
    final generation = _generation;
    isLoading = true;
    loadError = null;
    notifyListeners();
    try {
      final page = await repository.list();
      // Signed out meanwhile: this answer was for the previous user.
      if (generation != _generation) return;
      _records = page.records;
      total = page.total;
      hasLoaded = true;
    } on ApiException catch (e) {
      loadError = e.message;
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  Future<void> ensureLoaded() => hasLoaded || isLoading ? Future.value() : load();

  /// Forgets everything (on sign-out: the next user never sees these).
  void clear() {
    _generation++;
    _records = const [];
    total = 0;
    hasLoaded = false;
    loadError = null;
    notifyListeners();
  }
}
