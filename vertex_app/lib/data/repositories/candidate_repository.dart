import '../models/candidate.dart';
import '../services/api_service.dart';

class CandidateRepository {
  const CandidateRepository(this._api);
  final ApiService _api;

  Future<List<Candidate>> fetchAll() async {
    final data = await _api.get('/api/candidates');
    return (data['candidates'] as List)
        .map((e) => Candidate.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<Candidate> fetchById(String id) async {
    final data = await _api.get('/api/candidates/$id');
    return Candidate.fromJson(data['candidate'] as Map<String, dynamic>);
  }

  Future<void> create(Map<String, dynamic> payload) =>
      _api.post('/api/candidates', payload);
}
