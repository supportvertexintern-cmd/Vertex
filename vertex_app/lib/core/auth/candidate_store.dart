import 'package:flutter/foundation.dart';

import '../../data/repositories/candidate_repository.dart';
import '../../data/services/api_service.dart';

/// A candidate as the lists show it: a row of GET /api/v1/candidates.
class CandidateRecord {
  const CandidateRecord({
    required this.id,
    required this.fullName,
    required this.nationality,
    required this.opportunity,
    required this.gender,
    required this.phone,
    required this.email,
    required this.registeredAt,
    this.status = '',
  });

  factory CandidateRecord.fromJson(Map<String, dynamic> json) {
    final user = json['user'] is Map ? json['user'] as Map : const {};
    final applications = json['applications'] is List ? json['applications'] as List : const [];
    final latest = applications.isNotEmpty && applications.first is Map ? applications.first as Map : const {};
    final job = latest['job'] is Map ? latest['job'] as Map : const {};
    String text(Object? v) => v is String ? v : '';
    return CandidateRecord(
      id: json['id'] as String,
      fullName: text(json['full_name']).isNotEmpty ? text(json['full_name']) : text(user['full_name']),
      nationality: text(json['nationality']),
      // The programme applied for, else the role they want.
      opportunity: text(job['title']).isNotEmpty ? text(job['title']) : text(json['desired_role']),
      gender: text(json['gender']),
      phone: text(json['phone']),
      email: text(json['email']).isNotEmpty ? text(json['email']) : text(user['email']),
      registeredAt: DateTime.tryParse(text(json['created_at']))?.toLocal() ?? DateTime.now(),
      status: text(json['lifecycle_status']),
    );
  }

  final String id;
  final String fullName;
  final String nationality;
  final String opportunity;
  final String gender;
  final String phone;
  final String email;
  final DateTime registeredAt;

  /// The lifecycle status (identified, submitted, approved, ...).
  final String status;
}

/// The signed-in user's candidates, loaded from FastAPI (the first page,
/// newest first). Nothing is kept only on the phone: a new candidate is
/// submitted to the server and the list loaded again.
class CandidateStore extends ChangeNotifier {
  CandidateStore(this._repository);
  final CandidateRepository? _repository;

  /// For tests and screens shown before sign-in: no server.
  CandidateStore.offline() : _repository = null;

  List<CandidateRecord> _records = const [];
  int _generation = 0;
  int total = 0;
  bool isLoading = false;
  bool hasLoaded = false;

  /// Why the last load failed, to show with a retry; null when it didn't.
  String? loadError;

  List<CandidateRecord> get records => List.unmodifiable(_records);

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

  /// Loads once; later calls keep what's there (pull to refresh calls [load]).
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
