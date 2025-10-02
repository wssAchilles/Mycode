package com.urban.environment.backend.dto;

/**
 * 热力图数据传输对象
 * 用于向前端提供Google Maps热力图所需的数据格式
 */
public class HeatmapData {
	private double lat;
	private double lng;
	private double weight;

	public HeatmapData() {
	}

	public HeatmapData(double lat, double lng, double weight) {
		this.lat = lat;
		this.lng = lng;
		this.weight = weight;
	}

	public double getLat() {
		return lat;
	}

	public void setLat(double lat) {
		this.lat = lat;
	}

	public double getLng() {
		return lng;
	}

	public void setLng(double lng) {
		this.lng = lng;
	}

	public double getWeight() {
		return weight;
	}

	public void setWeight(double weight) {
		this.weight = weight;
	}
}