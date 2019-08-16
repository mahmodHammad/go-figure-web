import { ActivatedRoute, Router } from '@angular/router';
import { Component, OnInit, OnDestroy } from '@angular/core';

import { Vector } from '@app/structures/vector';
import { Point2D } from '@app/structures/point';
import { Drawing } from '@app/structures/drawing';
import { ApiService } from '@app/api/api.service';
import { FourierSeries } from '@app/structures/series';
import { OutputDatum } from '@app/drawing/viewer/output';
import { CanvasManager } from '@app/canvas/canvas_manager';
import { VectorPainter } from '@app/drawing/viewer/painters/vector-painter';
import { OutputPainter } from '@app/drawing/viewer/painters/output-painter';
import { OriginalPointsPainter } from '@app/drawing/viewer/painters/original-points-painter';

@Component({
  selector: 'iai-drawing-viewer',
  templateUrl: './drawing-viewer.component.html',
  styleUrls: ['./drawing-viewer.component.scss']
})
export class DrawingViewerComponent implements OnInit, OnDestroy {

  loading: boolean = true;
  id: number;
  time: number = 0;
  prevTime: number = 0;
  minTimeInterval: number = 0.0001;
  timeInterval: number = 0.005;
  run: boolean = false;
  output: OutputDatum[] = [];
  currentOutput: OutputDatum;
  outputTimeInterval: number = 0.0005;
  canvasManager: CanvasManager;
  series: FourierSeries;
  maxVectorCount: number = 1;
  drawing: Drawing;
  originalOpacity: number = 0.2;
  trackOutput: boolean = false;
  scale: number = 1;
  painters: {
    vector: VectorPainter;
    output: OutputPainter;
    originalPoints: OriginalPointsPainter;
  };

  constructor(private route: ActivatedRoute, private router: Router, private api: ApiService) {
    router.routeReuseStrategy.shouldReuseRoute = () => false;
  }

  ngOnInit() {
    this.id = +this.route.snapshot.paramMap.get('id');
    this.load();
  }

  ngOnDestroy() {
    this.stop();
  }

  onCanvasReady(canvasManager: CanvasManager) {
    this.canvasManager = canvasManager;
    this.painters = {
      vector: new VectorPainter(this.canvasManager),
      output: new OutputPainter(this.canvasManager),
      originalPoints: new OriginalPointsPainter(this.canvasManager),
    };
  }

  async load() {
    try {
      this.drawing = new Drawing(await this.api.getDrawing(this.id));
      this.maxVectorCount = this.drawing.drawVectors.length;

      if (!this.maxVectorCount) {
        setTimeout(()=>{
          this.loading = false;
          this.load()
        }, 1000)
      }
      else {
        this.series = new FourierSeries(this.drawing.drawVectors);
        this.initializeOutput();
        this.loading = false;
        this.start();
      }
    }
    catch (e) {
      this.router.navigateByUrl('404', {skipLocationChange: true});
    }
  }

  stop()  {
    this.time = 0;
    this.run = false;
    this.output = [];
  }

  start()  {
    if (this.run)
      return;

    this.run = true;

    this.animate();
  }

  animate() {
    if (!this.run)
      return;

    this.updateOutput();
    this.series.update(this.time, this.scale);

    this.repaint();
    this.updateTime();

    window.requestAnimationFrame(() => this.animate());
  }

  repaint() {
    this.repositionCanvas();
    this.canvasManager.clearCanvas();
    this.painters.originalPoints.paint(this.drawing.originalPoints, this.originalOpacity);
    this.painters.vector.paint(this.series.vectors.slice(0, this.maxVectorCount));
    this.painters.output.paint(this.output, this.time, this.currentOutput);
  }

  repositionCanvas() {
    if (this.trackOutput && this.series.vectors.length) {
      let finalVector = this.series.vectors[this.maxVectorCount - 1],
          point = new Point2D(finalVector.end.x * this.scale, finalVector.end.y * this.scale);

      this.canvasManager.centerOn(point);
    }
  }

  updateTime() {
    this.prevTime = this.time;
    this.time += this.timeInterval;

    if (this.time >= 1)
      this.time -= 1;
  }

  initializeOutput() {
    for (var time = 0; time < 1; time += this.outputTimeInterval) {
      this.output.push({time});
    }
  }

  updateOutput() {
    let index = (Math.floor(this.prevTime / this.outputTimeInterval) + 1) % this.output.length,
        finalIndex = Math.floor(this.time / this.outputTimeInterval) % this.output.length;

    //update all skipped outputs due to changing time interval
    while (this.time != this.prevTime && index != finalIndex) {
      this.updateOutputValues(this.output[index]);
      index = (index + 1) % this.output.length;
    }

    //update current output
    this.updateOutputValues(this.output[finalIndex]);
    this.currentOutput = {time: this.time, point: this.getOutputPoint(this.time)};
  }

  updateOutputValues(output: OutputDatum) {
    if (output.vectorCount == this.maxVectorCount)
      return;

    Object.assign(output, {
      vectorCount: this.maxVectorCount,
      point: this.getOutputPoint(output.time),
    });
  }

  getOutputPoint(time: number) {
    this.series.update(time, this.scale);

    let finalVector = this.series.vectors[this.maxVectorCount - 1];

    return new Point2D(finalVector.end.x, finalVector.end.y);
  }

  shiftOriginOnZoom(mousePosition: Point2D, originalScale: number, newScale: number) {
    let origin = this.canvasManager.origin,
        originalPoint = mousePosition.clone().shift(-origin.x, -origin.y).scale(1 / originalScale),
        newPoint = originalPoint.clone().scale(newScale).shift(origin.x, origin.y);

    this.canvasManager.shiftOrigin(mousePosition.x - newPoint.x, mousePosition.y - newPoint.y)
  }

  updateScale(scale: number, center?: Point2D) {
    if (center)
      this.shiftOriginOnZoom(center, this.scale, scale);

    this.scale = scale;

    for (let painter of Object.values(this.painters)) {
      painter.setScale(this.scale)
    }

    this.repaint();
  }

  onZoom(event) {
    let scale = Math.max(0.5, Math.min(1500, this.scale * event.scale));

    this.updateScale(scale, event.center);
  }

  zoomInAndSlow() {
    this.timeInterval = this.calculateSlowTimeInterval();
    this.trackOutput = true;
    this.updateScale(this.calculateFullZoomScale());
  }

  calculateSlowTimeInterval() {
    if (this.maxVectorCount < 40)
      return 0.0003;
    else if (this.maxVectorCount < 80)
      return 0.0002;
    else
      return this.minTimeInterval;
  }

  calculateFullZoomScale(): number {
    return this.maxVectorCount / 2.5;
  }

  resetZoomAndSpeed() {
    this.timeInterval = 0.005;
    this.trackOutput = false;
    this.updateScale(1);
    this.canvasManager.setOrigin(0, 0);
  }

}