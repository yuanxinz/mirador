(function($) {
  $.getTools = function() {
    if (this.svgOverlayTools) {
      return this.svgOverlayTools;
    }
    this.svgOverlayTools = [new $.Rectangle(), new $.Freehand(), new $.Polygon(), new $.Ellipse(), new $.Pin()];
    return this.svgOverlayTools;
  };

  OpenSeadragon.Viewer.prototype.svgOverlay = function(windowObj) {
    return new $.Overlay(this, windowObj, $.viewer.drawingToolsSettings, $.viewer.availableAnnotationDrawingTools);
  };

  $.Overlay = function(viewer, windowObj, drawingToolsSettings, availableAnnotationDrawingTools) {
    jQuery.extend(this, {
      disabled: true,
      window: windowObj,
      windowId: windowObj.windowId,
      commentPanel: null,
      mode: '', // Possible modes: 'create', 'translate', 'deform', 'edit' and '' as default.
      draftPaths: [],
      editedPaths: [],
      hoveredPath: null,
      path: null,
      segment: null,
      latestMouseDownTime: -1,
      doubleClickReactionTime: drawingToolsSettings.doubleClickReactionTime,
      availableAnnotationDrawingTools: availableAnnotationDrawingTools,
      pinSize: 10,
      hitOptions: {
        fill: true,
        stroke: true,
        segments: true,
        tolerance: 5
      }
    });

    // Initialization of overlay object.
    this.tools = $.getTools();
    this.currentTool = null;
    // Default colors.
    this.strokeColor = drawingToolsSettings.fillColor;
    this.fillColor = drawingToolsSettings.fillColor;
    this.fillColorAlpha = drawingToolsSettings.fillColorAlpha;
    this.viewer = viewer;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'draw_canvas_' + this.windowId;
    // Drawing of overlay border during development.
    // this.canvas.style.border = '1px solid yellow';
    this.viewer.canvas.appendChild(this.canvas);
    this.initialZoom = this.viewer.viewport.containerSize.x * this.viewer.viewport.getZoom(true);

    var _this = this;
    this.viewer.addHandler('animation', function() {
      _this.resize();
    });
    this.viewer.addHandler('open', function() {
      _this.resize();
    });
    jQuery.subscribe('toggleDrawingTool.' + _this.windowId, function(event, tool) {
      jQuery('#' + _this.window.viewer.id).parent().find('.hud-container').find('.draw-tool').css('opacity', '');
      if (_this.disabled) {
        jQuery('.qtip' + _this.windowId).qtip('hide');
        return;
      }
      jQuery('#' + _this.window.viewer.id).parents(".window").find(".qtip-viewer").hide();
      _this.currentTool = null;
      for (var i = 0; i < _this.tools.length; i++) {
        if (_this.tools[i].logoClass == tool) {
          _this.currentTool = _this.tools[i];
          jQuery('#' + _this.window.viewer.id).parent().find('.hud-container').find('.material-icons:contains(\'' + tool + '\')').parent('.draw-tool').css('opacity', '1');
        }
      }
    });
    jQuery.subscribe('toggleDefaultDrawingTool.' + _this.windowId, function(event) {
      jQuery('#' + _this.window.viewer.id).parent().find('.hud-container').find('.draw-tool').css('opacity', '');
      if (_this.disabled) {
        jQuery('.qtip' + _this.windowId).qtip('hide');
        return;
      }
      jQuery('#' + _this.window.viewer.id).parents(".window").find(".qtip-viewer").hide();
      _this.currentTool = null;
      for (var i = 0; i < _this.availableAnnotationDrawingTools.length; i++) {
        for (var j = 0; j < _this.tools.length; j++) {
          if (_this.availableAnnotationDrawingTools[i] == _this.tools[j].name) {
            _this.currentTool = _this.tools[j];
            jQuery('#' + _this.window.viewer.id).parent().find('.hud-container').find('.material-icons:contains(\'' + _this.tools[j].logoClass + '\')').parent('.draw-tool').css('opacity', '1');
            break;
          }
        }
        if (_this.currentTool) {
          break;
        }
      }
    });
    jQuery.subscribe('changeBorderColor.' + _this.windowId, function(event, color) {
      _this.strokeColor = color;
      if (_this.hoveredPath) {
        _this.hoveredPath.strokeColor = color;
        _this.paperScope.view.draw();
      }
    });
    jQuery.subscribe('changeFillColor.' + _this.windowId, function(event, color, alpha) {
      _this.fillColor = color;
      _this.fillColorAlpha = alpha;
      if (_this.hoveredPath && _this.hoveredPath.closed) {
        _this.hoveredPath.fillColor = color;
        _this.hoveredPath.fillColor.alpha = alpha;
        _this.paperScope.view.draw();
      }
    });
    jQuery.publish('initBorderColor.' + _this.windowId, _this.strokeColor);
    jQuery.publish('initFillColor.' + _this.windowId, [_this.fillColor, _this.fillColorAlpha]);

    this.resize();
    this.show();
    this.init();
  };

  $.Overlay.prototype = {
    init: function() {
      // Initialization of Paper.js overlay.
      var _this = this;
      this.paperScope = new paper.PaperScope();
      this.paperScope.setup('draw_canvas_' + _this.windowId);
      this.paperScope.activate();
      this.viewZoom = this.paperScope.view.zoom;
      this.paperScope.view.onFrame = function(event) {
        if (_this.paperScope.snapPoint) {
          _this.paperScope.snapPoint.remove();
        }
        if (_this.path && !_this.path.closed && _this.cursorLocation && _this.currentTool && _this.currentTool.idPrefix.indexOf('rough_path_') != -1) {
          var distanceToFirst = _this.path.segments[0].point.getDistance(_this.cursorLocation);
          if (_this.path.segments.length > 1 && distanceToFirst < _this.hitOptions.tolerance) {
            _this.paperScope.snapPoint = new _this.paperScope.Path.Circle({
              name: 'snapPoint',
              center: _this.path.segments[0].point,
              radius: _this.hitOptions.tolerance / _this.viewZoom,
              fillColor: _this.path.strokeColor,
              strokeColor: _this.path.strokeColor
            });
          }
        }
      };
      var mouseTool = jQuery.data(document.body, 'draw_canvas_' + _this.windowId);
      if (mouseTool) {
        mouseTool.remove();
      }
      mouseTool = new this.paperScope.Tool();
      mouseTool.overlay = this;
      mouseTool.onMouseUp = _this.onMouseUp;
      mouseTool.onMouseDrag = _this.onMouseDrag;
      mouseTool.onMouseMove = _this.onMouseMove;
      mouseTool.onMouseDown = _this.onMouseDown;
      mouseTool.onDoubleClick = _this.onDoubleClick;
      jQuery.data(document.body, 'draw_canvas_' + _this.windowId, mouseTool);
    },

    onMouseUp: function(event) {
      if (!this.overlay.disabled) {
        event.stopPropagation();
        document.body.style.cursor = "default";
        if (this.overlay.mode === 'deform' || this.overlay.mode === 'edit') {
          this.overlay.segment = null;
          this.overlay.path = null;
        }
        if (this.overlay.mode != 'create') {
          this.overlay.mode = '';
        }
        this.overlay.currentTool.onMouseUp(event, this.overlay);
      }
    },

    onMouseDrag: function(event) {
      if (!this.overlay.disabled) {
        event.stopPropagation();
        this.overlay.currentTool.onMouseDrag(event, this.overlay);
      } else {
        var absolutePoint = {
          'x': event.event.clientX,
          'y': event.event.clientY
        };
        jQuery.publish('updateTooltips.' + this.overlay.windowId, [event.point, absolutePoint]);
      }
      this.overlay.paperScope.view.draw();
    },

    onMouseMove: function(event) {
      this.overlay.cursorLocation = event.point;
      if (!this.overlay.disabled) {
        event.stopPropagation();
        this.overlay.currentTool.onMouseMove(event, this.overlay);
      } else {
        var absolutePoint = {
          'x': event.event.clientX,
          'y': event.event.clientY
        };
        jQuery.publish('updateTooltips.' + this.overlay.windowId, [event.point, absolutePoint]);
      }
      this.overlay.paperScope.view.draw();
    },

    onMouseDown: function(event) {
      if (this.overlay.disabled) {
        return;
      }
      event.stopPropagation();
      var date = new Date();
      var time = date.getTime();
      if (time - this.overlay.latestMouseDownTime < this.overlay.doubleClickReactionTime) {
        this.overlay.latestMouseDownTime = time;
        this.onDoubleClick(event);
      } else {
        this.overlay.latestMouseDownTime = time;
        var hitResult = this.overlay.paperScope.project.hitTest(event.point, this.overlay.hitOptions);
        if (hitResult && (!this.overlay.currentTool || (hitResult.item._name.toString().indexOf(this.overlay.currentTool.idPrefix) == -1 && this.overlay.mode === ''))) {
          var prefix = hitResult.item._name.toString();
          prefix = prefix.substring(0, prefix.lastIndexOf('_') + 1);
          for (var j = 0; j < this.overlay.tools.length; j++) {
            if (this.overlay.tools[j].idPrefix == prefix) {
              jQuery.publish('toggleDrawingTool.' + this.overlay.windowId, this.overlay.tools[j].logoClass);
              this.overlay.paperScope.project.activeLayer.selected = false;
              this.overlay.hoveredPath = null;
              this.overlay.segment = null;
              this.overlay.path = null;
              this.overlay.mode = '';
              break;
            }
          }
        }
        if (this.overlay.currentTool) {
          this.overlay.currentTool.onMouseDown(event, this.overlay);
          if (this.overlay.mode == 'translate' || this.overlay.mode == 'deform' || this.overlay.mode == 'edit') {
            if (this.overlay.path && this.overlay.path.data.annotation) {
              var inArray = false;
              for (var i = 0; i < this.overlay.editedPaths.length; i++) {
                if (this.overlay.editedPaths[i].name == this.overlay.path.name) {
                  inArray = true;
                  break;
                }
              }
              if (!inArray) {
                this.overlay.editedPaths.push(this.overlay.path);
              }
            }
          }
        }
      }
      this.overlay.hover();
      this.overlay.paperScope.view.draw();
    },

    onDoubleClick: function(event) {
      event.stopPropagation();
      if (this.overlay.currentTool) {
        this.overlay.currentTool.onDoubleClick(event, this.overlay);
      }
    },

    fitPinSize: function(shape) {
      var scale = 1 / shape.bounds.width;
      scale *= this.pinSize / this.viewZoom;
      shape.scale(scale, shape.segments[0].point);
    },

    resize: function() {
      var pointZero = this.viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(0, 0), true);
      var scale = this.viewer.viewport.containerSize.x * this.viewer.viewport.getZoom(true);
      this.canvas.width = scale;
      this.canvas.height = scale * (this.viewer.viewport.contentSize.y / this.viewer.viewport.contentSize.x);
      var transform = 'translate(0px,0px)';
      this.canvas.style.WebkitTransform = transform;
      this.canvas.style.msTransform = transform;
      this.canvas.style.transform = transform;
      this.canvas.style.marginLeft = pointZero.x + "px";
      this.canvas.style.marginTop = pointZero.y + "px";
      if (this.paperScope && this.paperScope.view) {
        this.paperScope.view.viewSize = new this.paperScope.Size(this.canvas.width, this.canvas.height);
        this.paperScope.view.zoom = scale / this.initialZoom;
        this.paperScope.view.center = new this.paperScope.Size(this.paperScope.view.bounds.width / 2, this.paperScope.view.bounds.height / 2);
        this.paperScope.view.update(true);
        this.viewZoom = this.paperScope.view.zoom;
        // Fit pins to the current zoom level.
        var items = this.paperScope.project.getItems({
          name: /^pin_/
        });
        for (var i = 0; i < items.length; i++) {
          this.fitPinSize(items[i]);
        }
      }
    },

    hover: function() {
      if (!this.currentTool) {
        if (this.hoveredPath) {
          this.hoveredPath.selected = false;
          this.hoveredPath = null;
        }
      } else if (this.hoveredPath) {
        if (this.hoveredPath._name.toString().indexOf(this.currentTool.idPrefix) == -1) {
          this.hoveredPath.selected = false;
          this.hoveredPath = null;
        }
        if (this.path && this.path._name.toString().indexOf(this.currentTool.idPrefix) != -1) {
          if (this.hoveredPath) {
            this.hoveredPath.selected = false;
          }
          this.hoveredPath = this.path;
          this.hoveredPath.selected = true;
        }
      } else if (this.path && this.path._name.toString().indexOf(this.currentTool.idPrefix) != -1) {
        this.hoveredPath = this.path;
        this.hoveredPath.selected = true;
      }
    },

    removeFocus: function() {
      if (this.hoveredPath) {
        this.hoveredPath.selected = false;
        this.hoveredPath = null;
      }
      if (this.path) {
        this.path.selected = false;
        this.path = null;
      }
    },

    restoreEditedShapes: function() {
      this.editedPaths = [];
      this.removeFocus();
    },

    restoreDraftShapes: function() {
      this.draftPaths = [];
      this.removeFocus();
    },

    // replaces paper.js objects with the required properties only.
    replaceShape: function(shape, annotation) {
      var cloned = new this.paperScope.Path({
        segments: shape.segments,
        name: shape.name
      });
      cloned.strokeColor = shape.strokeColor;
      if (shape.fillColor) {
        cloned.fillColor = shape.fillColor;
        if (shape.fillColor.alpha) {
          cloned.fillColor.alpha = shape.fillColor.alpha;
        }
      }
      cloned.closed = shape.closed;
      cloned.data.rotation = shape.data.rotation;
      cloned.data.annotation = annotation;
      cloned.scale(this.canvas.width / (this.viewZoom * this.viewer.viewport.contentSize.x), new this.paperScope.Point(0, 0));
      if (cloned.name.toString().indexOf('pin_') != -1) { // pin shapes with fixed size.
        this.fitPinSize(cloned);
      }
      shape.remove();
      return cloned;
    },

    // creating shapes used for backward compatibility.
    createRectangle: function(shape, annotation) {
      var scale = this.viewer.viewport.containerSize.y;
      var paperItems = [];
      var rect = new $.Rectangle();
      var initialPoint = {
        'x': shape.x * scale + 1,
        'y': shape.y * scale + 1
      };
      var currentMode = this.mode;
      var currentPath = this.path;
      var strokeColor = this.strokeColor;
      var fillColor = this.fillColor;
      var fillColorAlpha = this.fillColorAlpha;
      this.strokeColor = $.viewer.drawingToolsSettings.fillColor;
      this.fillColor = $.viewer.drawingToolsSettings.fillColor;
      this.fillColorAlpha = $.viewer.drawingToolsSettings.fillColorAlpha;
      this.mode = 'create';
      this.path = rect.createShape(initialPoint, this);
      var eventData = {
        'delta': {
          'x': shape.width * scale,
          'y': shape.height * scale
        }
      };
      rect.onMouseDrag(eventData, this);
      paperItems.push(this.path);
      paperItems[0].data.annotation = annotation;
      paperItems[0].selected = false;
      this.strokeColor = strokeColor;
      this.fillColor = fillColor;
      this.fillColorAlpha = fillColorAlpha;
      this.path = currentPath;
      this.mode = currentMode;
      return paperItems;
    },

    parseSVG: function(svg, annotation) {
      var paperItems = [];
      var svgParser = new DOMParser();
      var svgDOM = svgParser.parseFromString(svg, "text/xml");
      if (svgDOM.documentElement.nodeName == "parsererror") {
        return; // if svg is not valid XML structure - backward compatibility.
      }
      var svgTag = this.paperScope.project.importSVG(svg);
      // removes SVG tag which is the root object of comment SVG segment.
      var body = svgTag.removeChildren()[0];
      svgTag.remove();
      if (body.className == 'Group') {
        // removes group tag which wraps the set of objects of comment SVG segment.
        var items = body.removeChildren();
        for (var itemIdx = 0; itemIdx < items.length; itemIdx++) {
          paperItems.push(this.replaceShape(items[itemIdx], annotation));
        }
        body.remove();
      } else {
        paperItems.push(this.replaceShape(body, annotation));
      }
      this.paperScope.view.update(true);
      return paperItems;
    },

    // Restore latest view before rendering.
    restoreLastView: function(shapeArray) {
      for (var i = 0; i < this.editedPaths.length; i++) {
        for (var idx = 0; idx < shapeArray.length; idx++) {
          if (shapeArray[idx].name == this.editedPaths[i].name) {
            shapeArray[idx].segments = this.editedPaths[i].segments;
            shapeArray[idx].name = this.editedPaths[i].name;
            shapeArray[idx].strokeColor = this.editedPaths[i].strokeColor;
            if (this.editedPaths[i].fillColor) {
              shapeArray[idx].fillColor = this.editedPaths[i].fillColor;
              if (this.editedPaths[i].fillColor.alpha) {
                shapeArray[idx].fillColor.alpha = this.editedPaths[i].fillColor.alpha;
              }
            }
            shapeArray[idx].closed = this.editedPaths[i].closed;
            shapeArray[idx].data.rotation = this.editedPaths[i].data.rotation;
            shapeArray[idx].data.annotation = this.editedPaths[i].data.annotation;
            if (shapeArray[idx].name.toString().indexOf('pin_') != -1) { // pin shapes with fixed size.
              this.fitPinSize(shapeArray[idx]);
            }
          }
        }
      }
    },

    deselectAll: function() {
      if (this.paperScope && this.paperScope.view && this.paperScope.project) {
        this.paperScope.project.deselectAll();
        this.paperScope.view.update(true);
        this.destroyCommentPanel();
      }
    },

    hide: function() {
      this.canvas.style.display = 'none';
      this.deselectAll();
    },

    show: function() {
      this.canvas.style.display = 'block';
    },

    disable: function() {
      this.disabled = true;
      jQuery.publish('hideDrawTools.' + this.windowId);
      jQuery.publish('disableBorderColorPicker.' + this.windowId, this.disabled);
      jQuery.publish('disableFillColorPicker.' + this.windowId, this.disabled);
      jQuery.publish('enableTooltips.' + this.windowId);
      this.deselectAll();
    },

    enable: function() {
      var setDefaultTool = this.disabled;
      this.disabled = false;
      jQuery.publish('showDrawTools.' + this.windowId);
      jQuery.publish('disableBorderColorPicker.' + this.windowId, this.disabled);
      jQuery.publish('disableFillColorPicker.' + this.windowId, this.disabled);
      jQuery.publish('disableTooltips.' + this.windowId);
      if (setDefaultTool) {
        jQuery.publish('toggleDefaultDrawingTool.' + this.windowId);
      }
    },

    refresh: function() {
      this.paperScope.view.update(true);
    },

    destroyCommentPanel: function() {
      jQuery.publish('removeTooltips.' + this.windowId);
      jQuery(this.canvas).parents('.mirador-osd').qtip('destroy', true);
      this.commentPanel = null;
    },

    getName: function(tool) {
      return tool.idPrefix + $.genUUID();
    },

    getSVGString: function(shapes) {
      var svg = "<svg xmlns='http://www.w3.org/2000/svg'>";
      if (shapes.length > 1) {
        svg += "<g>";
        for (var i = 0; i < shapes.length; i++) {
          shapes[i].scale(this.viewZoom * this.viewer.viewport.contentSize.x / this.canvas.width, new this.paperScope.Point(0, 0));
          if (shapes[i].name.toString().indexOf('pin_') != -1) {
            this.fitPinSize(shapes[i]);
          }
          var anno = shapes[i].data.annotation;
          shapes[i].data.annotation = null;
          svg += shapes[i].exportSVG({
            "asString": true
          });
          shapes[i].data.annotation = anno;
        }
        svg += "</g>";
      } else {
        shapes[0].scale(this.viewZoom * this.viewer.viewport.contentSize.x / this.canvas.width, new this.paperScope.Point(0, 0));
        if (shapes[0].name.toString().indexOf('pin_') != -1) {
          this.fitPinSize(shapes[0]);
        }
        var annoSingle = shapes[0].data.annotation;
        shapes[0].data.annotation = null;
        svg += shapes[0].exportSVG({
          "asString": true
        });
        shapes[0].data.annotation = annoSingle;
      }
      svg += "</svg>";
      return svg;
    },

    onDrawFinish: function() {
      var shape = this.path;
      if (!shape) {
        return;
      }
      if (this.hoveredPath) {
        this.hoveredPath.selected = false;
      }
      this.hoveredPath = shape;
      this.hoveredPath.selected = true;
      this.segment = null;
      this.path = null;
      this.mode = '';
      this.draftPaths.push(shape);
      var _this = this;
      var annoTooltip = new $.AnnotationTooltip({
        "windowId": _this.windowId
      });
      if (!_this.commentPanel) {
        _this.commentPanel = jQuery(_this.canvas).parents('.mirador-osd').qtip({
          content: {
            text: annoTooltip.getEditor({})
          },
          position: {
            my: 'center',
            at: 'center'
          },
          style: {
            classes: 'qtip-bootstrap qtip' + _this.windowId
          },
          show: {
            event: false
          },
          hide: {
            fixed: true,
            delay: 300,
            event: false
          },
          events: {
            render: function(event, api) {
              jQuery.publish('annotationEditorAvailable.' + _this.windowId);
              jQuery.publish('disableTooltips.' + _this.windowId);

              var selector = '#annotation-editor-' + _this.windowId;
              jQuery(selector).parent().parent().draggable();

              tinymce.init({
                selector: selector + ' textarea',
                plugins: "image link media",
                menubar: false,
                statusbar: false,
                toolbar_items_size: 'small',
                toolbar: "bold italic | bullist numlist | link image media | removeformat",
                setup: function(editor) {
                  editor.on('init', function(args) {
                    tinymce.execCommand('mceFocus', false, args.target.id);
                  });
                }
              });

              jQuery(selector).on("submit", function(event) {
                event.preventDefault();
                jQuery(selector + ' a.save').click();
              });

              jQuery(selector + ' a.cancel').on("click", function(event) {
                event.preventDefault();
                var content = tinymce.activeEditor.getContent();
                if (content) {
                  if (!window.confirm("Do you want to cancel this annotation?")) {
                    return false;
                  }
                }
                api.destroy();

                // clear draft data.
                for (var idx = 0; idx < _this.draftPaths.length; idx++) {
                  _this.draftPaths[idx].remove();
                }
                _this.draftPaths = [];
                if (_this.path) {
                  _this.path.remove();
                }
                _this.paperScope.view.update(true);
                _this.paperScope.project.activeLayer.selected = false;
                _this.hoveredPath = null;
                _this.segment = null;
                _this.path = null;
                _this.mode = '';

                //reenable viewer tooltips
                jQuery.publish('enableTooltips.' + _this.windowId);
                _this.commentPanel = null;
              });

              jQuery(selector + ' a.save').on("click", function(event) {
                event.preventDefault();
                var tagText = jQuery(this).parents('.annotation-editor').find('.tags-editor').val(),
                  resourceText = tinymce.activeEditor.getContent(),
                  tags = [];
                tagText = $.trimString(tagText);
                if (tagText) {
                  tags = tagText.split(/\s+/);
                }

                var bounds = _this.viewer.viewport.getBounds(true);
                // var scope = _this.viewer.viewport.viewportToImageRectangle(bounds);

                var motivation = [],
                  resource = [],
                  on;

                var svg = _this.getSVGString(_this.draftPaths);

                if (tags && tags.length > 0) {
                  motivation.push("oa:tagging");
                  jQuery.each(tags, function(index, value) {
                    resource.push({
                      "@type": "oa:Tag",
                      "chars": value
                    });
                  });
                }
                motivation.push("oa:commenting");
                on = {
                  "@type": "oa:SpecificResource",
                  "full": _this.window.parent.canvasID,
                  "selector": {
                    "@type": "oa:SvgSelector",
                    "value": svg
                  }
                  // ,
                  // "scope": {
                  //   "@context": "http://www.harvard.edu/catch/oa.json",
                  //   "@type": "catch:Viewport",
                  //   "value": "xywh=" + Math.round(scope.x) + "," + Math.round(scope.y) + "," + Math.round(scope.width) + "," + Math.round(scope.height) //osd bounds
                  // }
                };
                resource.push({
                  "@type": "dctypes:Text",
                  "format": "text/html",
                  "chars": resourceText
                });
                var oaAnno = {
                  "@context": "http://iiif.io/api/presentation/2/context.json",
                  "@type": "oa:Annotation",
                  "motivation": motivation,
                  "resource": resource,
                  "on": on
                };
                //save to endpoint
                jQuery.publish('annotationCreated.' + _this.windowId, [oaAnno, shape]);

                api.destroy();
                //reenable viewer tooltips
                jQuery.publish('enableTooltips.' + _this.windowId);
                _this.commentPanel = null;
                // clear draft data.
                for (var idx = 0; idx < _this.draftPaths.length; idx++) {
                  _this.draftPaths[idx].remove();
                }
                _this.draftPaths = [];
                if (_this.path) {
                  _this.path.remove();
                }
                _this.paperScope.view.update(true);
                _this.paperScope.project.activeLayer.selected = false;
                _this.hoveredPath = null;
                _this.segment = null;
                _this.path = null;
                _this.mode = '';
              });
            }
          }
        });
        _this.commentPanel.qtip('show');
      }
    }
  };
}(Mirador));