// 控制面板组件
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:ml_platform/models/visualization_state.dart';
import 'package:ml_platform/widgets/common/custom_button.dart';

class ControlPanel extends StatelessWidget {
  final VoidCallback? onPlay;
  final VoidCallback? onPause;
  final VoidCallback? onReset;
  final VoidCallback? onStepForward;
  final VoidCallback? onStepBackward;
  final VoidCallback? onGenerateData;
  final Function(double)? onSpeedChanged;
  final Function(int)? onDataSizeChanged;

  const ControlPanel({
    Key? key,
    this.onPlay,
    this.onPause,
    this.onReset,
    this.onStepForward,
    this.onStepBackward,
    this.onGenerateData,
    this.onSpeedChanged,
    this.onDataSizeChanged,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Consumer<VisualizationState>(
      builder: (context, state, child) {
        return Card(
          elevation: 4,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 播放控制按钮组
                _buildPlaybackControls(context, state),
                const SizedBox(height: 20),
                
                // 速度控制
                _buildSpeedControl(context, state),
                const SizedBox(height: 20),
                
                // 数据控制
                _buildDataControl(context, state),
                const SizedBox(height: 20),
                
                // 进度显示
                _buildProgressIndicator(context, state),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildPlaybackControls(BuildContext context, VisualizationState state) {
    final isPlaying = state.playbackState == PlaybackState.playing;
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '播放控制',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            // 后退一步
            CustomIconButton(
              icon: Icons.skip_previous_rounded,
              onPressed: state.currentStep > 0 ? onStepBackward : null,
              tooltip: '上一步',
              size: 28,
            ),
            
            // 播放/暂停
            CustomIconButton(
              icon: isPlaying 
                  ? Icons.pause_rounded 
                  : Icons.play_arrow_rounded,
              onPressed: isPlaying ? onPause : onPlay,
              tooltip: isPlaying ? '暂停' : '播放',
              size: 36,
              backgroundColor: Theme.of(context).primaryColor.withOpacity(0.1),
            ),
            
            // 前进一步
            CustomIconButton(
              icon: Icons.skip_next_rounded,
              onPressed: state.currentStep < state.totalSteps - 1 
                  ? onStepForward 
                  : null,
              tooltip: '下一步',
              size: 28,
            ),
            
            // 重置
            CustomIconButton(
              icon: Icons.restart_alt_rounded,
              onPressed: onReset,
              tooltip: '重置',
              size: 28,
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildSpeedControl(BuildContext context, VisualizationState state) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              '动画速度',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: Theme.of(context).primaryColor.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                '${state.config.animationSpeed.toStringAsFixed(1)}x',
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  color: Theme.of(context).primaryColor,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        SliderTheme(
          data: SliderTheme.of(context).copyWith(
            activeTrackColor: Theme.of(context).primaryColor,
            inactiveTrackColor: Theme.of(context).primaryColor.withOpacity(0.3),
            thumbColor: Theme.of(context).primaryColor,
            overlayColor: Theme.of(context).primaryColor.withOpacity(0.2),
            thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 8),
            trackHeight: 4,
          ),
          child: Slider(
            value: state.config.animationSpeed,
            min: 0.1,
            max: 5.0,
            divisions: 49,
            onChanged: onSpeedChanged,
          ),
        ),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('0.1x', style: Theme.of(context).textTheme.bodySmall),
            Text('5.0x', style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ],
    );
  }

  Widget _buildDataControl(BuildContext context, VisualizationState state) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              '数据设置',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            Text(
              '${state.config.dataSize} 个元素',
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ],
        ),
        const SizedBox(height: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            CustomButton(
              text: '生成随机数据',
              icon: Icons.shuffle_rounded,
              onPressed: onGenerateData,
              isOutlined: true,
              height: 40,
            ),
            const SizedBox(height: 8),
            PopupMenuButton<int>(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  border: Border.all(color: Theme.of(context).primaryColor, width: 2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      '数据规模',
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        color: Theme.of(context).primaryColor,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Icon(
                      Icons.arrow_drop_down,
                      color: Theme.of(context).primaryColor,
                    ),
                  ],
                ),
              ),
              itemBuilder: (context) => [10, 20, 50, 100, 200, 500]
                  .map((size) => PopupMenuItem<int>(
                        value: size,
                        child: Text('$size 个元素'),
                      ))
                  .toList(),
              onSelected: onDataSizeChanged,
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildProgressIndicator(BuildContext context, VisualizationState state) {
    final progress = state.totalSteps > 0 
        ? state.currentStep / (state.totalSteps - 1) 
        : 0.0;
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              '执行进度',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            Text(
              '步骤 ${state.currentStep + 1} / ${state.totalSteps}',
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ],
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: LinearProgressIndicator(
            value: progress,
            minHeight: 8,
            backgroundColor: Theme.of(context).primaryColor.withOpacity(0.2),
            valueColor: AlwaysStoppedAnimation<Color>(
              Theme.of(context).primaryColor,
            ),
          ),
        ),
      ],
    );
  }
}
