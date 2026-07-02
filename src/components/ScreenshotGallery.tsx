import { useState } from 'react'
import { appFileUrl } from '../lib/electron-api'

interface Screenshot {
  timestamp: string
  imagePath: string
  aiPrediction?: string
  activityLabel?: string
  recommendation?: string
}

interface ScreenshotGalleryProps {
  screenshots: Screenshot[]
  maxDisplay?: number
}

function ScreenshotThumbnail({
  screenshot,
  onSelect
}: {
  screenshot: Screenshot
  onSelect: () => void
}) {
  const [failed, setFailed] = useState(false)
  const src = appFileUrl(screenshot.imagePath)

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative aspect-video bg-gray-700 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-500 transition-all"
    >
      {!failed && src ? (
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-gray-500 text-xs px-2 text-center gap-1">
          <span>Image unavailable</span>
          <span className="text-[10px] text-gray-600 truncate max-w-full font-mono">
            {screenshot.imagePath.split('/').pop()}
          </span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <p className="text-white text-xs font-medium truncate">
            {new Date(screenshot.timestamp).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </p>
        </div>
      </div>
    </button>
  )
}

export function ScreenshotGallery({ screenshots, maxDisplay = 10 }: ScreenshotGalleryProps) {
  const [selectedImage, setSelectedImage] = useState<Screenshot | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [modalFailed, setModalFailed] = useState(false)

  if (!screenshots || screenshots.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 text-center text-gray-400">
        <p className="text-sm">No automatic captures yet</p>
        <p className="text-xs text-gray-500 mt-1">
          Enable automatic capture above — screenshots appear here after each background check.
        </p>
      </div>
    )
  }

  const sortedScreenshots = [...screenshots].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  const displayedScreenshots = showAll
    ? sortedScreenshots
    : sortedScreenshots.slice(0, maxDisplay)

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const openModal = (screenshot: Screenshot) => {
    setModalFailed(false)
    setSelectedImage(screenshot)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Capture history</h3>
        {screenshots.length > maxDisplay && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
          >
            {showAll ? 'Show Less' : `View All (${screenshots.length})`}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {displayedScreenshots.map((screenshot, index) => (
          <ScreenshotThumbnail
            key={`${screenshot.imagePath}-${screenshot.timestamp}-${index}`}
            screenshot={screenshot}
            onSelect={() => openModal(screenshot)}
          />
        ))}
      </div>

      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="bg-gray-800 rounded-lg max-w-5xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between">
              <div>
                <h4 className="font-semibold text-lg">{formatTimestamp(selectedImage.timestamp)}</h4>
                {selectedImage.activityLabel && (
                  <p className="text-sm text-gray-400 mt-1">Activity: {selectedImage.activityLabel}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-4">
              {!modalFailed && appFileUrl(selectedImage.imagePath) ? (
                <img
                  src={appFileUrl(selectedImage.imagePath)}
                  alt=""
                  className="w-full rounded-lg"
                  onError={() => setModalFailed(true)}
                />
              ) : (
                <div className="text-center text-gray-500 py-12">Image file not found or unavailable</div>
              )}

              {(selectedImage.aiPrediction || selectedImage.recommendation) && (
                <div className="mt-4 space-y-2">
                  {selectedImage.aiPrediction && (
                    <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-3">
                      <p className="text-sm font-semibold text-blue-300 mb-1">AI Analysis</p>
                      <p className="text-blue-200 text-sm">{selectedImage.aiPrediction}</p>
                    </div>
                  )}
                  {selectedImage.recommendation && (
                    <div className="bg-purple-900/30 border border-purple-700 rounded-lg p-3">
                      <p className="text-sm font-semibold text-purple-300 mb-1">Recommendation</p>
                      <p className="text-purple-200 text-sm">{selectedImage.recommendation}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
