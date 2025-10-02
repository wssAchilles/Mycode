import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:geolocator/geolocator.dart';
import '../models/location_model.dart';
import '../services/location_service.dart';

/// 地图界面
/// 
/// 支持发送当前位置、查看位置详情和搜索兴趣点
/// 严格遵循LocationModel数据结构
class MapScreen extends StatefulWidget {
  /// 地图模式
  final MapMode mode;
  
  /// 聊天室ID（发送位置时使用）
  final String? chatRoomId;
  
  /// 发送者ID（发送位置时使用）
  final String? senderId;
  
  /// 接收者ID（发送位置时使用）
  final String? receiverId;
  
  /// 要查看的位置（查看模式时使用）
  final LocationModel? viewLocation;

  const MapScreen({
    Key? key,
    required this.mode,
    this.chatRoomId,
    this.senderId,
    this.receiverId,
    this.viewLocation,
  }) : super(key: key);

  @override
  State<MapScreen> createState() => _MapScreenState();
}

/// 地图模式枚举
enum MapMode {
  /// 发送位置模式
  send,
  /// 查看位置模式
  view,
}

class _MapScreenState extends State<MapScreen> {
  final LocationService _locationService = LocationService();
  final TextEditingController _searchController = TextEditingController();
  
  GoogleMapController? _mapController;
  LatLng? _currentPosition;
  LatLng? _selectedPosition;
  Set<Marker> _markers = {};
  bool _isLoading = false;
  bool _isLoadingCurrentLocation = false;

  @override
  void initState() {
    super.initState();
    _initializeMap();
  }

  @override
  void dispose() {
    _searchController.dispose();
    _mapController?.dispose();
    super.dispose();
  }

  /// 初始化地图
  void _initializeMap() async {
    if (widget.mode == MapMode.view && widget.viewLocation != null) {
      // 查看模式：显示指定位置
      _showViewLocation();
    } else {
      // 发送模式：获取当前位置
      _getCurrentLocation();
    }
  }

  /// 显示要查看的位置
  void _showViewLocation() {
    final location = widget.viewLocation!;
    final position = LatLng(location.latitude, location.longitude);
    
    setState(() {
      _selectedPosition = position;
      _markers = {
        Marker(
          markerId: const MarkerId('viewLocation'),
          position: position,
          infoWindow: InfoWindow(
            title: location.name ?? '位置',
            snippet: location.address ?? '',
          ),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
        ),
      };
    });
  }

  /// 获取当前位置
  void _getCurrentLocation() async {
    setState(() => _isLoadingCurrentLocation = true);
    
    try {
      Position? position = await _locationService.getCurrentLocation();
      if (position != null && mounted) {
        LatLng currentLatLng = LatLng(position.latitude, position.longitude);
        
        setState(() {
          _currentPosition = currentLatLng;
          _selectedPosition = currentLatLng;
          _markers = {
            Marker(
              markerId: const MarkerId('currentLocation'),
              position: currentLatLng,
              infoWindow: const InfoWindow(title: '我的位置'),
              icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueBlue),
            ),
          };
        });

        // 移动地图到当前位置
        _mapController?.animateCamera(
          CameraUpdate.newLatLngZoom(currentLatLng, 15.0),
        );
      }
    } catch (e) {
      _showErrorSnackBar('获取当前位置失败：${e.toString()}');
    } finally {
      if (mounted) {
        setState(() => _isLoadingCurrentLocation = false);
      }
    }
  }

  /// 地图创建完成回调
  void _onMapCreated(GoogleMapController controller) {
    _mapController = controller;
    
    // 如果有初始位置，移动到该位置
    if (_selectedPosition != null) {
      _mapController?.animateCamera(
        CameraUpdate.newLatLngZoom(_selectedPosition!, 15.0),
      );
    }
  }

  /// 地图点击事件
  void _onMapTap(LatLng position) {
    if (widget.mode == MapMode.send) {
      setState(() {
        _selectedPosition = position;
        _markers = {
          Marker(
            markerId: const MarkerId('selectedLocation'),
            position: position,
            infoWindow: const InfoWindow(title: '选中的位置'),
            icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
          ),
        };
      });
    }
  }

  /// 发送当前位置
  void _sendCurrentLocation() async {
    if (widget.chatRoomId == null || widget.senderId == null) return;

    setState(() => _isLoading = true);

    try {
      await _locationService.shareCurrentLocationMessage(
        chatRoomId: widget.chatRoomId!,
        senderId: widget.senderId!,
        receiverId: widget.receiverId!,
        name: '我的位置',
      );

      if (mounted) {
        Navigator.of(context).pop();
        _showSuccessSnackBar('位置发送成功');
      }
    } catch (e) {
      _showErrorSnackBar('发送位置失败：${e.toString()}');
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  /// 发送选中的位置
  void _sendSelectedLocation() async {
    if (widget.chatRoomId == null || widget.senderId == null || _selectedPosition == null) return;

    setState(() => _isLoading = true);

    try {
      await _locationService.sharePOILocationMessage(
        chatRoomId: widget.chatRoomId!,
        senderId: widget.senderId!,
        receiverId: widget.receiverId!,
        latitude: _selectedPosition!.latitude,
        longitude: _selectedPosition!.longitude,
        name: '选中的位置',
      );

      if (mounted) {
        Navigator.of(context).pop();
        _showSuccessSnackBar('位置发送成功');
      }
    } catch (e) {
      _showErrorSnackBar('发送位置失败：${e.toString()}');
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  /// 开始实时位置分享
  void _startLiveLocationSharing() async {
    if (widget.chatRoomId == null || widget.senderId == null) return;

    // 显示时长选择对话框
    int? minutes = await _showDurationDialog();
    if (minutes == null) return;

    setState(() => _isLoading = true);

    try {
      await _locationService.startLiveLocationSharing(
        chatRoomId: widget.chatRoomId!,
        senderId: widget.senderId!,
        receiverId: widget.receiverId!,
        durationMinutes: minutes,
      );

      if (mounted) {
        Navigator.of(context).pop();
        _showSuccessSnackBar('开始分享实时位置，时长：$minutes 分钟');
      }
    } catch (e) {
      _showErrorSnackBar('开始实时位置分享失败：${e.toString()}');
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  /// 显示时长选择对话框
  Future<int?> _showDurationDialog() async {
    return showDialog<int>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('选择分享时长'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                title: const Text('15 分钟'),
                onTap: () => Navigator.of(context).pop(15),
              ),
              ListTile(
                title: const Text('1 小时'),
                onTap: () => Navigator.of(context).pop(60),
              ),
              ListTile(
                title: const Text('8 小时'),
                onTap: () => Navigator.of(context).pop(480),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('取消'),
            ),
          ],
        );
      },
    );
  }

  /// 显示成功提示
  void _showSuccessSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.green,
      ),
    );
  }

  /// 显示错误提示
  void _showErrorSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.mode == MapMode.send ? '发送位置' : '查看位置'),
        backgroundColor: Theme.of(context).primaryColor,
        foregroundColor: Colors.white,
        actions: widget.mode == MapMode.send
            ? [
                IconButton(
                  icon: const Icon(Icons.my_location),
                  onPressed: _isLoadingCurrentLocation ? null : _getCurrentLocation,
                  tooltip: '获取当前位置',
                ),
              ]
            : null,
      ),
      body: Stack(
        children: [
          // 地图主体
          GoogleMap(
            onMapCreated: _onMapCreated,
            onTap: _onMapTap,
            initialCameraPosition: CameraPosition(
              target: _selectedPosition ?? 
                     (widget.viewLocation != null 
                        ? LatLng(widget.viewLocation!.latitude, widget.viewLocation!.longitude)
                        : const LatLng(35.6762, 139.6503)), // 默认东京位置
              zoom: 15.0,
            ),
            markers: _markers,
            myLocationEnabled: widget.mode == MapMode.send,
            myLocationButtonEnabled: false,
            mapToolbarEnabled: false,
          ),

          // 搜索框（仅发送模式）
          if (widget.mode == MapMode.send)
            Positioned(
              top: 16,
              left: 16,
              right: 16,
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(8),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.1),
                      blurRadius: 4,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: '搜索地点...',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () => _searchController.clear(),
                    ),
                    border: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  ),
                ),
              ),
            ),

          // 位置信息卡片（查看模式）
          if (widget.mode == MapMode.view && widget.viewLocation != null)
            Positioned(
              bottom: 16,
              left: 16,
              right: 16,
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        widget.viewLocation!.name ?? '未知位置',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      if (widget.viewLocation!.address != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          widget.viewLocation!.address!,
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.grey[600],
                          ),
                        ),
                      ],
                      const SizedBox(height: 8),
                      Text(
                        '${widget.viewLocation!.latitude.toStringAsFixed(6)}, ${widget.viewLocation!.longitude.toStringAsFixed(6)}',
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.grey[500],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

          // 加载指示器
          if (_isLoading || _isLoadingCurrentLocation)
            Container(
              color: Colors.black.withOpacity(0.3),
              child: const Center(
                child: CircularProgressIndicator(),
              ),
            ),
        ],
      ),
      bottomNavigationBar: widget.mode == MapMode.send
          ? Container(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _isLoading ? null : _sendCurrentLocation,
                      icon: const Icon(Icons.my_location),
                      label: const Text('发送当前位置'),
                    ),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: (_isLoading || _selectedPosition == null) ? null : _sendSelectedLocation,
                      icon: const Icon(Icons.place),
                      label: const Text('发送选中位置'),
                    ),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _isLoading ? null : _startLiveLocationSharing,
                      icon: const Icon(Icons.share_location),
                      label: const Text('开始实时位置分享'),
                    ),
                  ),
                ],
              ),
            )
          : null,
    );
  }
}
